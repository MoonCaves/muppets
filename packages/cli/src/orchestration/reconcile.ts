/**
 * KyberBot — Reconciliation Pass
 *
 * Symphony §8.5: every poll tick should perform (A) stall detection on
 * running runs and (B) tracker-state refresh against running issues, both
 * before dispatching new work. We adopt the same shape, plus (C) a
 * dispatch-slot calculator that respects per-agent and per-state concurrency
 * limits read from AGENT.md.
 *
 * The reconciliation pass is intentionally side-effect-light at the edges:
 * it transitions stalled runs to a terminal phase, refreshes issue state
 * snapshots, and reports available slot counts. It does NOT dispatch new
 * work directly — the heartbeat loop does that, using the reported counts.
 */

import { getOrchDb } from './db.js';
import { getRunPhase, transitionPhase, isTerminalPhase, RunPhase } from './run-phases.js';
import { failRun } from './runs.js';
import { releaseCheckout } from './issues.js';
import { logActivity } from './activity.js';
import { createLogger } from '../logger.js';
import type { Issue, IssueStatus } from './types.js';

const logger = createLogger('reconcile');

const DEFAULT_STALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — Symphony default

// ═══════════════════════════════════════════════════════════════════════════════
// EXTERNAL STATE SOURCES (pluggable, registered at startup)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExternalStateSource {
  /** Source identifier — e.g. "github", "linear". Stored on issue.external_source. */
  kind: string;
  /**
   * Fetch the latest issue state for the given internal IDs. Implementations
   * resolve the mapping from internal ID → external system internally.
   * Returning an entry-less map for an ID = "no change". Throwing = transient
   * error; reconciliation logs and keeps existing state.
   */
  refresh(issueIds: number[]): Promise<Map<number, Pick<Issue, 'status'>>>;
}

const externalSources = new Map<string, ExternalStateSource>();

export function registerExternalStateSource(source: ExternalStateSource): void {
  externalSources.set(source.kind, source);
  logger.info(`Registered external state source: ${source.kind}`);
}

export function clearExternalStateSources(): void {
  externalSources.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STALL DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface StallDetectionResult {
  stalledRunIds: number[];
}

/**
 * Find runs that are status='running' but whose latest phase transition is
 * older than the configured stall timeout. Transition them to RunPhase.Stalled
 * and release their issue checkout.
 *
 * Symphony §8.5 Part A: elapsed_ms is computed from the most recent
 * last_phase_at if any phase transition has been recorded, else from
 * started_at.
 */
export function detectStalls(opts: { stallTimeoutMs?: number; now?: number } = {}): StallDetectionResult {
  const stallTimeout = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  if (stallTimeout <= 0) return { stalledRunIds: [] };

  const now = opts.now ?? Date.now();
  const db = getOrchDb();
  const runs = db.prepare(
    "SELECT id, started_at, phase_history FROM heartbeat_runs WHERE status = 'running'"
  ).all() as Array<{ id: number; started_at: string; phase_history: string | null }>;

  const stalled: number[] = [];

  for (const row of runs) {
    let lastEventMs = Date.parse(row.started_at + 'Z'); // SQLite timestamps are UTC but missing Z
    if (Number.isNaN(lastEventMs)) lastEventMs = Date.parse(row.started_at);

    if (row.phase_history) {
      try {
        const history = JSON.parse(row.phase_history) as Array<{ at: string }>;
        if (history.length > 0) {
          const lastAt = Date.parse(history[history.length - 1].at);
          if (!Number.isNaN(lastAt)) lastEventMs = lastAt;
        }
      } catch {
        // Fall through to started_at
      }
    }

    if (Number.isNaN(lastEventMs)) continue;
    const elapsedMs = now - lastEventMs;
    if (elapsedMs > stallTimeout) {
      stalled.push(row.id);
    }
  }

  for (const id of stalled) {
    failRun(id, `Stalled: no phase transition for ${stallTimeout}ms`, RunPhase.Stalled);
    logger.warn(`Marked run ${id} as stalled`);
  }

  return { stalledRunIds: stalled };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRACKER STATE REFRESH
// ═══════════════════════════════════════════════════════════════════════════════

export interface RefreshResult {
  refreshedIssueIds: number[];
  canceledRunIds: number[];
  errors: Array<{ source: string; error: string }>;
}

/**
 * Symphony §8.5 Part B: for each currently running issue, fetch the latest
 * external state. If the external system reports the issue terminal, cancel
 * the matching heartbeat run via RunPhase.CanceledByReconciliation.
 *
 * On source error, log and keep workers running — Symphony explicitly says
 * "If state refresh fails, keep workers running and try again on the next tick."
 */
export async function refreshExternalState(): Promise<RefreshResult> {
  const result: RefreshResult = { refreshedIssueIds: [], canceledRunIds: [], errors: [] };
  if (externalSources.size === 0) return result;

  const db = getOrchDb();
  const runningIssues = db.prepare(
    "SELECT id, external_source FROM issues WHERE status = 'in_progress' AND external_source IS NOT NULL"
  ).all() as Array<{ id: number; external_source: string }>;

  const bySource = new Map<string, number[]>();
  for (const row of runningIssues) {
    const list = bySource.get(row.external_source) ?? [];
    list.push(row.id);
    bySource.set(row.external_source, list);
  }

  for (const [source, ids] of bySource) {
    const handler = externalSources.get(source);
    if (!handler) continue;
    try {
      const updates = await handler.refresh(ids);
      for (const [issueId, updated] of updates) {
        result.refreshedIssueIds.push(issueId);
        db.prepare(
          "UPDATE issues SET status = ?, last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(updated.status, issueId);

        // If the issue went terminal externally, cancel the matching run
        if (updated.status === 'done' || updated.status === 'cancelled') {
          const runs = db.prepare(
            "SELECT id FROM heartbeat_runs WHERE status = 'running' AND result_summary LIKE ?"
          ).all(`%KYB-${issueId}%`) as Array<{ id: number }>;
          for (const run of runs) {
            failRun(
              run.id,
              `Canceled: external state changed to ${updated.status}`,
              RunPhase.CanceledByReconciliation,
            );
            result.canceledRunIds.push(run.id);
          }
          try { releaseCheckout(issueId); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      result.errors.push({ source, error: String(err) });
      logger.warn(`External state refresh failed for ${source}`, { error: String(err) });
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCH SLOT COMPUTATION (Symphony §8.3)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConcurrencyConfig {
  max_concurrent_runs?: number;
  max_by_state?: Record<string, number>;
}

export interface SlotsByState {
  global: number;
  byState: Record<string, number>;
}

/**
 * Compute available dispatch slots for an agent, given its concurrency
 * config and current in-flight load. Negative results are clamped to 0.
 */
export function computeDispatchSlots(agentName: string, concurrency: ConcurrencyConfig = {}): SlotsByState {
  const db = getOrchDb();
  const runningCount = (db.prepare(
    "SELECT COUNT(*) as c FROM heartbeat_runs WHERE agent_name = ? AND status = 'running'"
  ).get(agentName) as { c: number }).c;

  const globalLimit = concurrency.max_concurrent_runs ?? 1;
  const globalSlots = Math.max(globalLimit - runningCount, 0);

  const byState: Record<string, number> = {};
  if (concurrency.max_by_state) {
    for (const [stateName, limit] of Object.entries(concurrency.max_by_state)) {
      if (typeof limit !== 'number' || limit < 1) continue;
      const issueCount = (db.prepare(
        "SELECT COUNT(*) as c FROM issues WHERE LOWER(assigned_to) = LOWER(?) AND status = ?"
      ).get(agentName, stateName) as { c: number }).c;
      byState[stateName] = Math.max(limit - issueCount, 0);
    }
  }

  return { global: globalSlots, byState };
}

/**
 * True when the agent should be allowed to start a new run. Combines the
 * global concurrency limit with optional per-state limits derived from the
 * picked issue's status.
 */
export function canDispatch(
  agentName: string,
  concurrency: ConcurrencyConfig,
  candidateIssueStatus: IssueStatus,
): { allowed: boolean; reason?: string } {
  const slots = computeDispatchSlots(agentName, concurrency);
  if (slots.global <= 0) {
    return { allowed: false, reason: `at max_concurrent_runs (${concurrency.max_concurrent_runs ?? 1})` };
  }
  const stateLimit = concurrency.max_by_state?.[candidateIssueStatus];
  if (stateLimit !== undefined) {
    const remaining = slots.byState[candidateIssueStatus] ?? stateLimit;
    if (remaining <= 0) {
      return { allowed: false, reason: `at max_by_state[${candidateIssueStatus}] (${stateLimit})` };
    }
  }
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC TICK ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

export interface ReconcileTickOptions {
  stallTimeoutMs?: number;
  now?: number;
}

export interface ReconcileTickResult {
  durationMs: number;
  stalledRunIds: number[];
  refreshedIssueIds: number[];
  canceledRunIds: number[];
  errors: Array<{ source: string; error: string }>;
}

/**
 * Symphony §8.1 tick sequence:
 *   1. Reconcile running issues (stall detection + state refresh)
 *   2. (Caller runs dispatch preflight + dispatch using computeDispatchSlots)
 *   3. Notify observability/status consumers of state changes
 *
 * This function is called at the start of each heartbeat loop entry. It
 * returns a structured summary so the snapshot API can surface "last
 * reconcile ran at … took …ms".
 */
export async function reconcileTick(opts: ReconcileTickOptions = {}): Promise<ReconcileTickResult> {
  const start = Date.now();
  const stalls = detectStalls({ stallTimeoutMs: opts.stallTimeoutMs, now: opts.now });
  const refresh = await refreshExternalState();
  const durationMs = Date.now() - start;

  if (stalls.stalledRunIds.length > 0 || refresh.canceledRunIds.length > 0) {
    logActivity({
      actor: 'system',
      action: 'reconcile.tick',
      entity_type: 'fleet',
      entity_id: null,
      details: JSON.stringify({
        stalled: stalls.stalledRunIds,
        canceled: refresh.canceledRunIds,
        refreshed: refresh.refreshedIssueIds.length,
        durationMs,
      }),
    });
  }

  return {
    durationMs,
    stalledRunIds: stalls.stalledRunIds,
    refreshedIssueIds: refresh.refreshedIssueIds,
    canceledRunIds: refresh.canceledRunIds,
    errors: refresh.errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LATEST TICK SNAPSHOT (read by /api/v1/state)
// ═══════════════════════════════════════════════════════════════════════════════

let lastTickAt: string | null = null;
let lastTickDurationMs: number | null = null;

export function recordTickCompletion(result: ReconcileTickResult): void {
  lastTickAt = new Date().toISOString();
  lastTickDurationMs = result.durationMs;
}

export function getLastTickInfo(): { lastTickAt: string | null; lastDurationMs: number | null } {
  return { lastTickAt, lastDurationMs: lastTickDurationMs };
}
