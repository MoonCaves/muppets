/**
 * Gap Revival Extension — Repetitive Content Guard
 *
 * Our own copy of Ian's isRepetitiveContent classifier, kept as a SUPERSET.
 * Zero patch to upstream decay.ts — we import nothing from there.
 *
 * MAINTENANCE RULE (see REATTACHMENT.md § Point 3):
 *   On each upstream release, diff their isRepetitiveContent against this file.
 *   If they add patterns, add them here too. Never remove patterns.
 *   Our superset stance: we may guard more than Ian does, never less.
 *
 * WHY WE OWN THIS:
 *   The gap-revival bonus should never apply to repetitive content —
 *   a heartbeat task firing every 30 min has no meaningful "gap revival."
 *   But we can't import Ian's private function. We replicate and extend.
 *
 * Current upstream patterns (verified 2026-05-08 at decay.ts):
 *   /heartbeat\s+task/i
 *   /heartbeat-state/i
 *   /check\s+posthog/i
 *
 * NO upstream imports. Pure function.
 */

/** Ian's patterns — keep in sync with upstream decay.ts isRepetitiveContent. */
const UPSTREAM_PATTERNS: RegExp[] = [
  /heartbeat\s+task/i,
  /heartbeat-state/i,
  /check\s+posthog/i,
];

/**
 * Our additional patterns — content classes where gap-revival signal is noise.
 * Extend this list; do not shrink it.
 */
const OUR_PATTERNS: RegExp[] = [
  /\[HEARTBEAT\]/i,       // KyberBot heartbeat prefix
  /\[SYSTEM\]/i,          // System-generated events
  /^HEARTBEAT_OK$/i,      // Silent heartbeat return value
];

const ALL_PATTERNS = [...UPSTREAM_PATTERNS, ...OUR_PATTERNS];

/**
 * Returns true if the content title is repetitive/system-generated
 * and should be excluded from gap-revival bonus calculation.
 *
 * @param title  The timeline_events.title value to classify.
 */
export function isRepetitiveContent(title: string): boolean {
  return ALL_PATTERNS.some(p => p.test(title));
}
