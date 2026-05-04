/**
 * KyberBot — Orchestration Startup Guard
 *
 * Hard-fails fleet startup when orchestration is enabled but an agent has
 * no Opus-class model assigned for the CEO/worker orch paths. Pure helper
 * — invoked by FleetManager.start() per loaded agent. Tests construct
 * fake IdentityConfig objects directly.
 *
 * Why only 'opus' is accepted (not 'sonnet' or 'haiku'):
 *   The orch heartbeats run multi-step planning (CEO) and execution
 *   (worker) with tool-use across the whole company state. The CEO's
 *   "what should we do next" decision needs reasoning depth. Sonnet is
 *   fine for tool-use throughput but lacks the planning depth; haiku is
 *   weaker still. Running orch on either has produced silent regressions
 *   in our fleet (Apr–May 2026). Hard-fail at startup is cheaper than
 *   discovering it three days later in shipped tasks.
 *
 * Why this guard reads raw identity fields, NOT the resolver:
 *   The resolver (`resolveOrchModelFromIdentity`) intentionally falls back
 *   from ceo/worker_model → heartbeat_model → 'sonnet' for backward compat.
 *   That fallback is exactly the silent drift this guard exists to surface.
 *   If the guard called the resolver, an agent with `heartbeat_model: opus`
 *   and no ceo/worker_model would pass the guard and run on opus at
 *   runtime — but the operator would have lost the explicit-config
 *   property the guard is meant to enforce. Strict raw-field reads force
 *   operators to set ceo_model + worker_model in identity.yaml, which is
 *   the desired UX going forward. The deprecation log handles users still
 *   on heartbeat_model gracefully.
 *
 * Escape hatch: set orchestration_enabled=false to skip the guard entirely.
 *   No env-var override. The guard's signal is the whole point — diluting
 *   it is a regression vector.
 */
import type { IdentityConfig } from '../types.js';

export class OrchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchConfigError';
  }
}

/**
 * Throws OrchConfigError if orchestration is enabled and the agent's identity
 * does not specify `ceo_model: opus` AND `worker_model: opus`.
 *
 * Silent when orchestration is disabled. Reads identity fields directly —
 * does NOT use the resolver fallback chain (see file doc comment for why).
 *
 * @param agentName  Display name for the error message.
 * @param identity   The agent's parsed identity.yaml.
 * @param orchEnabled  Fleet-wide orchestration_enabled flag (from DB settings).
 * @param agentRoot  Path to the agent directory, for the fix instruction.
 */
export function assertOrchConfig(
  agentName: string,
  identity: IdentityConfig,
  orchEnabled: boolean,
  agentRoot: string
): void {
  if (!orchEnabled) return;

  const ceo = identity.ceo_model ?? null;
  const worker = identity.worker_model ?? null;

  // Only 'opus' accepted. 'sonnet' and 'haiku' rejected (insufficient
  // reasoning depth for orch). Unset (null) rejected — silent fallback
  // masks misconfiguration; we want explicit config going forward.
  const isBad = (m: string | null): boolean => m !== 'opus';

  if (!isBad(ceo) && !isBad(worker)) return;

  const ceoLabel = ceo ?? 'unset';
  const workerLabel = worker ?? 'unset';

  throw new OrchConfigError(
    `[ORCH_GUARD] orchestration_enabled=true but agent "${agentName}" lacks ` +
      `\`ceo_model: opus\` and/or \`worker_model: opus\` in identity.yaml.\n` +
      `  ceo_model=${ceoLabel} worker_model=${workerLabel} ` +
      `(only 'opus' is accepted — orch paths need reasoning depth)\n` +
      `  Fix: edit ${agentRoot}/identity.yaml — set BOTH:\n` +
      `    ceo_model: opus\n` +
      `    worker_model: opus\n` +
      `  Note: if you have \`heartbeat_model: opus\` already, you still need\n` +
      `  to set ceo_model + worker_model explicitly. The legacy fallback is\n` +
      `  intentionally NOT honored by this guard — explicit config is the\n` +
      `  whole point. The runtime resolver still falls back gracefully.\n` +
      `  Or disable orchestration: kyberbot orch (toggle off in CLI).\n` +
      `  Background: see packages/cli/src/orchestration/guard.ts doc comment.`
  );
}
