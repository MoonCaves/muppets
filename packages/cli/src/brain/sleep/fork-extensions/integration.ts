/**
 * Gap Revival Extension — Integration
 *
 * ZERO UPSTREAM IMPORTS — no cross-tree dependencies on kyberbot source.
 * All kyberbot dependencies are injected at the call site (sleep/index.ts).
 *
 * Exports:
 *   - DecayResult: local interface (structurally compatible with upstream)
 *   - initGapRevival(root, getDb): idempotent — safe to call multiple times
 *   - makeWrappedDecayStep(upstream, getDb): factory for the wrapped decay step;
 *     boot is LAZY — initGapRevival fires on the first decay invocation, not at
 *     agent startup. This means no change is needed in sleep/index.ts beyond the
 *     import swap.
 *
 * ─── REQUIRED PATCH TO UPSTREAM ──────────────────────────────────────────────
 *
 * TWO LINES + CONST must change in:
 *   packages/cli/src/brain/sleep/index.ts
 *
 * Find:
 *   import { runDecayStep } from './steps/decay.js';
 *
 * Replace with:
 *   import { runDecayStep as upstreamRunDecayStep } from './steps/decay.js';
 *   import { makeWrappedDecayStep } from './fork-extensions/integration.js';
 *   const runDecayStep = makeWrappedDecayStep(upstreamRunDecayStep, getTimelineDb);
 *
 * No separate boot call needed — initGapRevival fires lazily on the first decay
 * cycle. Works for both startSleepAgent and runSleepCycleNow (parallel entry
 * points in v1.9.5 — neither calls the other).
 *
 * On upstream rebase:
 *   If Ian changes the decay step signature, update these lines.
 *   The factory is generic over TConfig — it adapts automatically.
 *   See REATTACHMENT.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { runHookAfterDecay } from './hook-after-decay.js';
import { runCanaryCheck } from './hook-on-access.js';

/**
 * Local definition — structurally matches upstream's DecayResult.
 * No cross-tree import needed.
 */
export interface DecayResult {
  count: number;
  processed: number;
  errors?: string[];
}

/**
 * Db getter type — derived from what the hook actually accepts.
 * Matches getTimelineDb's effective signature without importing it.
 */
type DbGetter = (root: string) => Promise<Parameters<typeof runHookAfterDecay>[0]>;

let canaryPassed = false;

/**
 * Run the startup canary check. Call once at agent boot.
 * Throws if the trigger is not installed correctly.
 *
 * @param root   KyberBot root directory.
 * @param getDb  Injected db getter — pass getTimelineDb from sleep/index.ts.
 */
export async function initGapRevival(root: string, getDb: DbGetter): Promise<void> {
  if (canaryPassed) return; // idempotent — safe to call multiple times
  const db = await getDb(root);
  runCanaryCheck(db);
  canaryPassed = true;
}

/**
 * Factory: wraps Ian's runDecayStep with our after-decay hook.
 * The upstream function AND the db getter are injected — zero cross-tree imports.
 *
 * Usage in sleep/index.ts:
 *   const runDecayStep = makeWrappedDecayStep(upstreamRunDecayStep, getTimelineDb);
 *
 * @param upstream  Ian's runDecayStep function (injected).
 * @param getDb     Db getter function (injected — pass getTimelineDb).
 * @returns         A wrapped function with the identical signature.
 */
export function makeWrappedDecayStep<TConfig>(
  upstream: (root: string, config: TConfig) => Promise<DecayResult>,
  getDb: DbGetter,
): (root: string, config: TConfig) => Promise<DecayResult> {
  return async function wrappedDecayStep(root: string, config: TConfig): Promise<DecayResult> {
    // Lazy boot: fire initGapRevival on first decay invocation.
    // root and getDb are already in scope — no new injection needed.
    // initGapRevival is idempotent (canaryPassed guard), so subsequent calls are no-ops.
    if (!canaryPassed) {
      try {
        await initGapRevival(root, getDb);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[gap-revival] initGapRevival failed (non-fatal, gap-revival disabled for this cycle): ${msg}`);
      }
    }

    // Run Ian's decay step first. We don't interfere with it.
    const result = await upstream(root, config);

    // Run our after-decay hook. Non-fatal — errors are logged, not thrown.
    try {
      if (!canaryPassed) {
        console.warn('[gap-revival] skipping hook-after-decay: canary did not pass, gap-revival inactive.');
      } else {
        const db = await getDb(root);
        runHookAfterDecay(db);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gap-revival] hook-after-decay threw (non-fatal, Ian's result preserved): ${msg}`);
    }

    return result;
  };
}
