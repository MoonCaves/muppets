/**
 * Gap Revival Extension — Priority Override
 *
 * Computes final priority for a single item using ACT-R activation
 * + gap-revival bonus, then writes it to timeline_events.priority.
 *
 * Called from hook-after-decay.ts (batch, once per decay cycle).
 *
 * Design contract:
 *   - We OWN the priority field for items in gap_revival_state.
 *   - Ian's decay step writes first; we override immediately after.
 *   - Repetitive content (isRepetitiveContent → true) is SKIPPED —
 *     Ian's formula owns those; we don't touch them.
 *   - Items NOT in gap_revival_state are SKIPPED — no side table means
 *     never accessed via a tracked path; Ian's formula owns those too.
 *
 * NO upstream imports. Pure logic + a DB handle passed in from hook-after-decay.ts.
 */

import type { DbHandle } from './db-handle.js';
import { computePriority } from './activation.js';
import { computeRevivalBonus, getPreviousAccessMs } from './revival-bonus.js';
import { isRepetitiveContent } from './repetitive-guard.js';

export interface GapRevivalRow {
  memory_id: number;
  access_timestamps: string;  // JSON array of ISO-8601 strings
  accesses_before_window: number;
  last_access_at: string | null;
  title: string;              // joined from timeline_events for the repetitive check
}

/**
 * Parse ISO-8601 strings from gap_revival_state.access_timestamps into epoch-ms.
 */
function parseTimestamps(json: string): number[] {
  try {
    const arr = JSON.parse(json) as string[];
    return arr.map(s => new Date(s).getTime()).filter(n => !isNaN(n));
  } catch {
    return [];
  }
}

/**
 * Compute and write priority for one item.
 *
 * @param db         SQLite database handle (both gap_revival_state and timeline_events).
 * @param row        Row from gap_revival_state joined with timeline_events.title.
 * @param now        Injectable timestamp for testing.
 * @returns          Computed priority, or null if skipped (repetitive content).
 */
export function overridePriority(
  db: DbHandle,
  row: GapRevivalRow,
  now: number = Date.now(),
): number | null {
  // Skip repetitive content — Ian's formula owns these.
  if (isRepetitiveContent(row.title)) return null;

  const timestamps = parseTimestamps(row.access_timestamps);

  // Revival bonus: based on gap between the two most recent accesses.
  // The most recent access is timestamps[last]; previous is timestamps[last-1].
  // If only one access exists, no gap to compute — bonus is 0.
  const previousMs = getPreviousAccessMs(timestamps);
  const bonus = computeRevivalBonus(previousMs, now);

  const priority = computePriority(
    timestamps,
    row.accesses_before_window,
    bonus,
    now,
  );

  // Write to timeline_events.priority.
  // Clamped to [0.001, 0.999] to avoid edge-case sigmoid saturation issues.
  const clamped = Math.min(0.999, Math.max(0.001, priority));

  const stmt = db.prepare(
    `UPDATE timeline_events SET priority = ? WHERE id = ?`,
  );
  stmt.run(clamped, row.memory_id);

  return clamped;
}
