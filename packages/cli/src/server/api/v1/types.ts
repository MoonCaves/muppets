/**
 * KyberBot — /api/v1 Response Types
 *
 * Stable contract between the fleet's HTTP API and any consumer (desktop,
 * CLI, third-party). Shape mirrors Symphony §13.7.2 with naming adjusted
 * for our domain (agents, not coding-agent runs against a tracker).
 *
 * Anything exported from here is a public API surface — bumping fields
 * is a breaking change for the desktop.
 */

import type { RunPhase, PhaseHistoryEntry } from '../../../orchestration/run-phases.js';

export interface RunRow {
  id: number;
  agent_name: string;
  type: 'orchestration' | 'worker';
  status: 'running' | 'completed' | 'failed';
  phase: RunPhase | null;
  started_at: string;
  finished_at: string | null;
  result_summary: string | null;
  error: string | null;
  recent_events: PhaseHistoryEntry[];
}

export interface AgentRow {
  name: string;
  status: 'running' | 'starting' | 'stopped' | 'error' | 'unreachable';
  description: string | null;
  type: 'local' | 'remote';
  uptime_ms: number;
  current_run: RunRow | null;
}

export interface FleetTotals {
  /** Number of runs currently in flight. */
  running: number;
  /** Currently empty for v1; reserved for retry-queue support. */
  retrying: number;
  /** Stalled runs since fleet startup. */
  stalled: number;
  canceled: number;
}

export interface ReconcileSummary {
  last_tick_at: string | null;
  last_duration_ms: number | null;
}

export interface FleetStateResponse {
  generated_at: string;
  fleet_uptime_ms: number;
  counts: FleetTotals;
  agents: AgentRow[];
  running: RunRow[];
  recent: RunRow[];
  reconcile: ReconcileSummary;
}

export interface AgentStateResponse {
  name: string;
  status: AgentRow['status'];
  description: string | null;
  workspace: { path: string } | null;
  attempts: { recent_failures: number };
  running: RunRow | null;
  retry: null;
  last_error: string | null;
  recent_events: PhaseHistoryEntry[];
}

export interface RefreshResponse {
  queued: boolean;
  coalesced: boolean;
  /** ISO timestamp of the most recent tick that completed before this request returned. */
  triggered_at: string;
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
