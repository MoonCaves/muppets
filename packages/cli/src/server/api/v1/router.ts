/**
 * KyberBot — /api/v1 Router
 *
 * Wires the snapshot endpoints with explicit dependency injection so the
 * routes can be exercised in tests without spinning up a FleetManager.
 *
 * Endpoints:
 *   GET  /api/v1/state            — fleet-wide snapshot
 *   GET  /api/v1/agents/:name     — agent-scoped detail
 *   POST /api/v1/refresh          — queue an immediate reconcile tick
 */

import express, { Router, Request, Response } from 'express';
import { listRuns } from '../../../orchestration/runs.js';
import { reconcileTick, recordTickCompletion, getLastTickInfo } from '../../../orchestration/reconcile.js';
import type {
  AgentRow,
  AgentStateResponse,
  FleetStateResponse,
  RefreshResponse,
  RunRow,
} from './types.js';
import type { HeartbeatRun } from '../../../orchestration/types.js';
import type { PhaseHistoryEntry, RunPhase } from '../../../orchestration/run-phases.js';
import { createLogger } from '../../../logger.js';

const logger = createLogger('api-v1');

// Refresh coalescing: if multiple POST /refresh requests arrive within this
// window, only the first triggers a tick and the rest get coalesced=true.
const REFRESH_COALESCE_MS = 5_000;
let inflightRefresh: Promise<void> | null = null;
let lastRefreshAt = 0;

export interface ApiV1Deps {
  /** Returns shallow status info for every known agent (local + remote). */
  listAgents: () => Array<{
    name: string;
    description: string | null;
    type: 'local' | 'remote';
    status: AgentRow['status'];
    root: string | null;
    uptime_ms: number;
  }>;
  /** Returns the fleet's start time in ms-since-epoch. */
  getFleetStartedAt: () => number;
}

export function createApiV1Router(deps: ApiV1Deps): Router {
  const router = Router();
  router.use(express.json());

  router.get('/state', (_req, res) => {
    try {
      res.json(buildFleetState(deps));
    } catch (err) {
      logger.error('GET /api/v1/state failed', { error: String(err) });
      res.status(500).json({ error: { code: 'state_failed', message: String(err) } });
    }
  });

  router.get('/agents/:name', (req, res) => {
    try {
      const snapshot = buildAgentState(deps, req.params.name);
      if (!snapshot) {
        res.status(404).json({ error: { code: 'agent_not_found', message: `Agent '${req.params.name}' is not registered` } });
        return;
      }
      res.json(snapshot);
    } catch (err) {
      logger.error('GET /api/v1/agents/:name failed', { error: String(err) });
      res.status(500).json({ error: { code: 'agent_state_failed', message: String(err) } });
    }
  });

  router.post('/refresh', async (_req, res) => {
    const now = Date.now();
    const triggered_at = new Date(now).toISOString();

    // Coalesce repeated refreshes — both the inflight check and the elapsed
    // window guard against thundering herds from a click-happy user.
    if (inflightRefresh || (now - lastRefreshAt) < REFRESH_COALESCE_MS) {
      const response: RefreshResponse = { queued: true, coalesced: true, triggered_at };
      res.status(202).json(response);
      return;
    }

    inflightRefresh = (async () => {
      try {
        const tick = await reconcileTick();
        recordTickCompletion(tick);
        lastRefreshAt = Date.now();
      } catch (err) {
        logger.warn('Manual reconcile tick failed', { error: String(err) });
      } finally {
        inflightRefresh = null;
      }
    })();

    const response: RefreshResponse = { queued: true, coalesced: false, triggered_at };
    res.status(202).json(response);
  });

  return router;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SNAPSHOT BUILDERS (exported for tests)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildFleetState(deps: ApiV1Deps): FleetStateResponse {
  const agentRows = deps.listAgents();
  const allRuns = listRuns({ limit: 200 });

  const runningRuns = allRuns.filter(r => r.status === 'running');
  const stalledCount = allRuns.filter(r => r.phase === 'stalled').length;
  const canceledCount = allRuns.filter(r => r.phase === 'canceled_by_reconciliation').length;

  const recentRuns = allRuns
    .filter(r => r.status !== 'running')
    .slice(0, 25)
    .map(toRunRow);

  const agents: AgentRow[] = agentRows.map(a => {
    const currentRun = runningRuns.find(r => r.agent_name.toLowerCase() === a.name.toLowerCase()) ?? null;
    return {
      name: a.name,
      status: a.status,
      description: a.description,
      type: a.type,
      uptime_ms: a.uptime_ms,
      current_run: currentRun ? toRunRow(currentRun) : null,
    };
  });

  const tick = getLastTickInfo();
  return {
    generated_at: new Date().toISOString(),
    fleet_uptime_ms: Date.now() - deps.getFleetStartedAt(),
    counts: {
      running: runningRuns.length,
      retrying: 0,
      stalled: stalledCount,
      canceled: canceledCount,
    },
    agents,
    running: runningRuns.map(toRunRow),
    recent: recentRuns,
    reconcile: { last_tick_at: tick.lastTickAt, last_duration_ms: tick.lastDurationMs },
  };
}

export function buildAgentState(deps: ApiV1Deps, name: string): AgentStateResponse | null {
  const agent = deps.listAgents().find(a => a.name.toLowerCase() === name.toLowerCase());
  if (!agent) return null;

  const runs = listRuns({ agent_name: agent.name, limit: 50 });
  const running = runs.find(r => r.status === 'running') ?? null;
  const recentFailures = runs.filter(r => r.status === 'failed').length;
  const lastFailure = runs.find(r => r.status === 'failed' && r.error);

  // recent_events is the union of phase_history from the most recent runs,
  // bounded so the response stays small.
  const recentEvents: PhaseHistoryEntry[] = [];
  for (const r of runs.slice(0, 5)) {
    const events = parsePhaseHistory(r.phase_history);
    for (const e of events) recentEvents.push(e);
  }
  recentEvents.sort((a, b) => a.at.localeCompare(b.at));
  const trimmedEvents = recentEvents.slice(-25);

  return {
    name: agent.name,
    status: agent.status,
    description: agent.description,
    workspace: agent.root ? { path: agent.root } : null,
    attempts: { recent_failures: recentFailures },
    running: running ? toRunRow(running) : null,
    retry: null,
    last_error: lastFailure?.error ?? null,
    recent_events: trimmedEvents,
  };
}

function toRunRow(r: HeartbeatRun): RunRow {
  return {
    id: r.id,
    agent_name: r.agent_name,
    type: r.type,
    status: r.status,
    phase: (r.phase as RunPhase | null) ?? null,
    started_at: r.started_at,
    finished_at: r.finished_at,
    result_summary: r.result_summary,
    error: r.error,
    recent_events: parsePhaseHistory(r.phase_history).slice(-10),
  };
}

function parsePhaseHistory(raw: string | null): PhaseHistoryEntry[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as PhaseHistoryEntry[]; } catch { return []; }
}
