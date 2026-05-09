/**
 * Gap Revival Extension — On-Access Hook
 *
 * Responsibilities:
 *   1. Startup canary check — verify the SQLite trigger is live.
 *      Boot the extension. Refuse to proceed if trigger is broken.
 *   2. That's it. Priority writes happen in hook-after-decay.ts (batch, per cycle).
 *
 * Canary protocol (see schema.sql § "Canary row"):
 *   1. Pick the lowest-id row in timeline_events as the test target.
 *   2. Issue: UPDATE timeline_events SET access_count = access_count + 1 WHERE id = ?
 *      This fires the trigger (if live).
 *   3. Within 1 second, read gap_revival_state WHERE memory_id = ?
 *   4. Verify last_access_at is fresh (< 2s old).
 *   5. If stale or NULL → trigger is broken. Log loud, throw.
 *
 * Side effect: leaves one extra timestamp in the canary row's access_timestamps.
 * Acceptable noise (documented in schema.sql).
 *
 * Called from: integration.ts on extension startup.
 * NO upstream imports.
 */

import type { DbHandle } from './db-handle.js';

const CANARY_TIMEOUT_MS = 2000; // trigger must fire within 2s (it's synchronous — any miss is catastrophic)

/**
 * Run the startup canary check.
 * Throws if the trigger is not firing correctly.
 *
 * @param db  SQLite database handle (must have both timeline_events and gap_revival_state).
 */
export function runCanaryCheck(db: DbHandle): void {
  // Pick the lowest-id event as our canary target.
  const target = db.prepare(
    `SELECT id FROM timeline_events ORDER BY id ASC LIMIT 1`,
  ).get() as { id: number } | undefined;

  if (!target) {
    // No timeline events yet — nothing to check. Skip silently.
    // The trigger will be verified on first real access.
    console.warn('[gap-revival] canary: no timeline_events rows yet, skipping check');
    return;
  }

  const beforeMs = Date.now();

  // Fire the trigger.
  db.prepare(
    `UPDATE timeline_events SET access_count = COALESCE(access_count, 0) + 1 WHERE id = ?`,
  ).run(target.id);

  // Trigger is synchronous in SQLite — it ran in the same statement.
  // Read the result immediately.
  const row = db.prepare(
    `SELECT last_access_at FROM gap_revival_state WHERE memory_id = ?`,
  ).get(target.id) as { last_access_at: string | null } | undefined;

  if (!row || !row.last_access_at) {
    throw new Error(
      `[gap-revival] CANARY FAILED: trigger did not write to gap_revival_state for memory_id=${target.id}. ` +
      `Check that gap_revival_state table exists and trigger gap_revival_capture_access is installed. ` +
      `See REATTACHMENT.md for recovery steps.`,
    );
  }

  const writtenMs = new Date(row.last_access_at).getTime();
  if (Date.now() - writtenMs > CANARY_TIMEOUT_MS) {
    throw new Error(
      `[gap-revival] CANARY FAILED: trigger fired but last_access_at is stale ` +
      `(${row.last_access_at}). Expected < ${CANARY_TIMEOUT_MS}ms ago. ` +
      `Possible stale trigger from a previous schema version.`,
    );
  }

  console.info(
    `[gap-revival] canary OK: trigger live for memory_id=${target.id} ` +
    `(${Date.now() - beforeMs}ms)`,
  );
}
