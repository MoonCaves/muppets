/**
 * Gap Revival Extension — Gap-Scaled Revival Bonus
 *
 * Formula:
 *   bonus = min(MAX_BONUS, max(0, ln(gap_days / THRESHOLD) × SCALE))
 *
 * Constants (locked):
 *   THRESHOLD = 21 days — 5-week return gives bonus ≈ 0.102; calibrated against
 *                         production Bali Brotherhood cycles (threshold=30 gave near-zero).
 *   SCALE     = 0.20
 *   MAX_BONUS = 1.0     — cosmetic cap; ln(100yr gap) ≈ 1.42 without it.
 *
 * Reference points (threshold=21, scale=0.20):
 *   gap=5wk  (35d)  →  bonus ≈ 0.102
 *   gap=6wk  (42d)  →  bonus ≈ 0.138
 *   gap=60d         →  bonus ≈ 0.210
 *   gap=90d         →  bonus ≈ 0.290
 *   gap=6mo  (180d) →  bonus ≈ 0.428
 *   gap=1yr  (365d) →  bonus ≈ 0.571
 *   gap=2yr         →  bonus ≈ 0.707
 *   gap=3yr         →  bonus ≈ 0.788
 *
 * Applied only when gap to PREVIOUS access exceeds THRESHOLD.
 * "Previous access" = second-to-last timestamp in gap_revival_state.access_timestamps
 * (the new access will have just been appended by the trigger before hook runs).
 *
 * NO upstream imports. Pure math.
 */

const THRESHOLD_DAYS = 21;  // calibrated against production Bali Brotherhood cycles
const SCALE = 0.20;
const MAX_BONUS = 1.0;

const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * Compute the gap-revival bonus for a memory item that was just accessed.
 *
 * @param previousAccessMs  Epoch-ms of the access BEFORE the current one.
 *                          Pass 0 or undefined if no prior access exists (bonus = 0).
 * @param now               Current epoch-ms (injectable for testing).
 * @returns Bonus in [0, MAX_BONUS]. Zero if gap is below threshold.
 */
export function computeRevivalBonus(
  previousAccessMs: number | undefined,
  now: number = Date.now(),
): number {
  if (!previousAccessMs || previousAccessMs <= 0) return 0;

  const gap_ms = now - previousAccessMs;
  const gap_days = gap_ms / MS_PER_DAY;

  if (gap_days <= THRESHOLD_DAYS) return 0;

  const raw = Math.log(gap_days / THRESHOLD_DAYS) * SCALE;
  return Math.min(MAX_BONUS, Math.max(0, raw));
}

/**
 * Extract the previous access timestamp from a stored timestamps array.
 *
 * The trigger appends the CURRENT access before the hook runs, so
 * the second-to-last entry is the previous access.
 *
 * @param timestamps  Epoch-ms array from gap_revival_state (already including new access).
 * @returns Epoch-ms of previous access, or undefined if fewer than 2 entries.
 */
export function getPreviousAccessMs(timestamps: number[]): number | undefined {
  if (timestamps.length < 2) return undefined;
  return timestamps[timestamps.length - 2];
}
