/**
 * KyberBot — Run-Attempt Phase State Machine
 *
 * Lifts Symphony §7.2's named run-attempt phases into the heartbeat-run
 * model so observability surfaces (desktop run inspector, snapshot API)
 * can render *why* a run is mid-flight or terminated, not just "running"
 * or "failed". Distinct from `state-machine.ts`, which models issue status
 * transitions (backlog → todo → in_progress → ...).
 */

import { getOrchDb } from './db.js';
import { createLogger } from '../logger.js';

const logger = createLogger('run-phase');

/**
 * Ordered phase enum. Earlier phases precede later ones in any successful
 * run. Terminal phases (Succeeded/Failed/TimedOut/Stalled/CanceledByReconciliation)
 * are mutually exclusive — once entered, no further transitions occur.
 */
export const RunPhase = {
  PreparingWorkspace: 'preparing_workspace',
  BuildingPrompt: 'building_prompt',
  LaunchingAgent: 'launching_agent',
  InitializingSession: 'initializing_session',
  StreamingTurn: 'streaming_turn',
  Finishing: 'finishing',
  Succeeded: 'succeeded',
  Failed: 'failed',
  TimedOut: 'timed_out',
  Stalled: 'stalled',
  CanceledByReconciliation: 'canceled_by_reconciliation',
} as const;

export type RunPhase = typeof RunPhase[keyof typeof RunPhase];

const TERMINAL_PHASES = new Set<RunPhase>([
  RunPhase.Succeeded,
  RunPhase.Failed,
  RunPhase.TimedOut,
  RunPhase.Stalled,
  RunPhase.CanceledByReconciliation,
]);

export function isTerminalPhase(phase: RunPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export interface PhaseHistoryEntry {
  phase: RunPhase;
  at: string;
  reason?: string;
}

/**
 * Transition a run to a new phase, appending to phase_history. Idempotent
 * — re-applying the same phase is a no-op. Once a run reaches a terminal
 * phase, further transitions are silently ignored (and logged at debug).
 */
export function transitionPhase(runId: number, phase: RunPhase, reason?: string): void {
  const db = getOrchDb();
  const row = db.prepare('SELECT phase, phase_history FROM heartbeat_runs WHERE id = ?')
    .get(runId) as { phase: string | null; phase_history: string | null } | undefined;
  if (!row) return;

  const currentPhase = (row.phase ?? null) as RunPhase | null;
  if (currentPhase && isTerminalPhase(currentPhase)) {
    logger.debug('Ignoring phase transition on terminal run', { runId, current: currentPhase, attempted: phase });
    return;
  }
  if (currentPhase === phase) return;

  let history: PhaseHistoryEntry[] = [];
  if (row.phase_history) {
    try {
      history = JSON.parse(row.phase_history) as PhaseHistoryEntry[];
    } catch {
      history = [];
    }
  }
  history.push({ phase, at: new Date().toISOString(), reason });

  db.prepare('UPDATE heartbeat_runs SET phase = ?, phase_history = ? WHERE id = ?')
    .run(phase, JSON.stringify(history), runId);
}

/**
 * Read the current phase + history for a run.
 */
export function getRunPhase(runId: number): { phase: RunPhase | null; history: PhaseHistoryEntry[] } {
  const db = getOrchDb();
  const row = db.prepare('SELECT phase, phase_history FROM heartbeat_runs WHERE id = ?')
    .get(runId) as { phase: string | null; phase_history: string | null } | undefined;
  if (!row) return { phase: null, history: [] };

  let history: PhaseHistoryEntry[] = [];
  if (row.phase_history) {
    try { history = JSON.parse(row.phase_history) as PhaseHistoryEntry[]; } catch { /* noop */ }
  }
  return {
    phase: (row.phase as RunPhase | null) ?? null,
    history,
  };
}
