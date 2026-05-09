/**
 * Gap Revival Extension — After-Decay Hook
 *
 * Runs immediately after Ian's runDecayStep() completes.
 * Batch-recomputes priority for every item in gap_revival_state
 * using ACT-R activation + gap-revival bonus, then writes results
 * to timeline_events.priority.
 *
 * Replaces Ian's priority for tracked items only. Items NOT in
 * gap_revival_state (never accessed via a tracked path) are untouched.
 *
 * Why batch here instead of on-access:
 *   - The trigger writes gap_revival_state synchronously on each access.
 *   - Priority writes happen here, once per decay cycle (typically hourly).
 *   - This avoids one extra DB write on every search/recall while still
 *     keeping priorities fresh on a human-meaningful timescale.
 *
 * NO upstream imports.
 * Called from: integration.ts, which wraps the runDecayStep call site.
 */

import type { DbHandle } from './db-handle.js';
import { overridePriority, type GapRevivalRow } from './priority-override.js';

export interface HookAfterDecayResult {
  processed: number;   // items we computed a new priority for
  skipped: number;     // items skipped (repetitive content)
  errors: string[];    // non-fatal errors (log and continue)
}

/**
 * Batch-recompute priorities for all gap_revival_state items.
 *
 * @param db   SQLite database handle (must have gap_revival_state and timeline_events).
 * @param now  Injectable timestamp for testing (defaults to Date.now()).
 */
export function runHookAfterDecay(
  db: DbHandle,
  now: number = Date.now(),
): HookAfterDecayResult {
  const result: HookAfterDecayResult = { processed: 0, skipped: 0, errors: [] };

  // Fetch all tracked items, joined with title for the repetitive guard.
  const rows = db.prepare(`
    SELECT
      g.memory_id,
      g.access_timestamps,
      g.accesses_before_window,
      g.last_access_at,
      COALESCE(t.title, '') AS title
    FROM gap_revival_state g
    LEFT JOIN timeline_events t ON t.id = g.memory_id
  `).all() as GapRevivalRow[];

  for (const row of rows) {
    try {
      const written = overridePriority(db, row, now);
      if (written === null) {
        result.skipped++;
      } else {
        result.processed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`memory_id=${row.memory_id}: ${msg}`);
      // Non-fatal — continue processing other rows.
    }
  }

  if (result.errors.length > 0) {
    console.error(
      `[gap-revival] hook-after-decay: ${result.errors.length} error(s):\n` +
      result.errors.join('\n'),
    );
  }

  console.info(
    `[gap-revival] hook-after-decay: processed=${result.processed} skipped=${result.skipped} errors=${result.errors.length}`,
  );

  return result;
}
