/**
 * Gap Revival Extension — ACT-R Activation Formula
 *
 * Formula:
 *   A = ln( Σ t_i^(-D) + n_before × t_avg^(-D) )
 *   priority = sigmoid(A − τ + bonus)
 *
 * Constants (locked):
 *   D   = 0.35  — decay exponent (ACT-R standard)
 *   CAP = 10    — max stored timestamps (matches gap_revival_state window)
 *   TAU = 0.74  — threshold; calibrated so "1 access 1 month ago" → priority ≈ 0.5
 *
 * t floor: Math.max(elapsed_ms, 3_600_000) — defensive guard against double-write
 * in the same minute pegging sigmoid to 0.99+. 1-hour floor, not a tunable constant.
 *
 * NO upstream imports. Pure math, pure TypeScript.
 * Integration point: called from priority-override.ts after decay hook runs.
 */

const D = 0.35;          // ACT-R decay exponent
const CAP = 10;           // must match trigger window in schema.sql
const TAU = 0.74;         // sigmoid threshold — tune here if warm baseline shifts
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const FLOOR_MS = 3_600_000; // 1-hour t floor — defensive only, not a tunable

/**
 * Compute raw ACT-R activation from stored access timestamps.
 *
 * @param timestamps  Array of epoch-ms timestamps (up to CAP entries, most recent).
 *                    Sourced from gap_revival_state.access_timestamps (parsed JSON).
 * @param accesses_before_window  Count of accesses that fell off the rolling window.
 *                                Sourced from gap_revival_state.accesses_before_window.
 * @param now         Current epoch-ms (injectable for testing; defaults to Date.now()).
 * @returns Raw activation value A. Not yet adjusted by τ or bonus.
 */
export function computeActivation(
  timestamps: number[],
  accesses_before_window: number,
  now: number = Date.now(),
): number {
  if (timestamps.length === 0) return -Infinity;

  let sum = 0;

  // Exact timestamps within the window (up to CAP)
  for (const ts of timestamps) {
    const elapsed = Math.max(now - ts, FLOOR_MS);
    const t_years = elapsed / YEAR_MS;
    sum += Math.pow(t_years, -D);
  }

  // Approximation for dropped accesses (accesses_before_window)
  // t_avg proxy: use oldest stored timestamp as lower bound for their age.
  // This underestimates their age (they're older than oldest stored),
  // so the approximation is slightly generous. Acceptable at scale.
  if (accesses_before_window > 0 && timestamps.length > 0) {
    const oldest = Math.min(...timestamps);
    const t_avg_elapsed = Math.max(now - oldest, FLOOR_MS);
    const t_avg_years = t_avg_elapsed / YEAR_MS;
    sum += accesses_before_window * Math.pow(t_avg_years, -D);
  }

  return Math.log(sum);
}

/**
 * Logistic sigmoid. Maps (-∞, +∞) → (0, 1).
 */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute final priority for a memory item.
 *
 * @param timestamps              Stored access timestamps (epoch-ms).
 * @param accesses_before_window  Overflow counter from gap_revival_state.
 * @param bonus                   Gap-revival bonus from revival-bonus.ts (0 if no gap).
 * @param now                     Injectable timestamp for testing.
 * @returns Priority in (0, 1). Write to timeline_events.priority via priority-override.ts.
 */
export function computePriority(
  timestamps: number[],
  accesses_before_window: number,
  bonus: number = 0,
  now: number = Date.now(),
): number {
  if (timestamps.length === 0 && accesses_before_window === 0) {
    // No access history — return sigmoid at baseline (no adjustment)
    return sigmoid(-TAU + bonus);
  }
  const A = computeActivation(timestamps, accesses_before_window, now);
  return sigmoid(A - TAU + bonus);
}
