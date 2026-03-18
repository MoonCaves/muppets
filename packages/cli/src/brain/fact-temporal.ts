/**
 * KyberBot — Fact Temporal Expiry Detection
 *
 * Detects time-bound facts ("I have an exam tomorrow") and calculates
 * absolute expiry dates so they automatically disappear from retrieval
 * after becoming irrelevant.
 *
 * Pure heuristic parsing — no LLM needed.
 */

export interface TemporalResult {
  is_temporal: boolean;
  expires_at: string | null;   // ISO 8601
  temporal_expression: string | null;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * Add whole days to a Date, returning a new Date at midnight UTC.
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Get the last day of a month (1-indexed), returning midnight UTC on
 * the following day so the fact remains valid through the entire last day.
 */
function endOfMonth(year: number, month: number): Date {
  // month is 0-indexed in Date constructor; the 0th day of month+1 = last day of month
  return new Date(Date.UTC(year, month, 1)); // first day of *next* month
}

/**
 * Find the next occurrence of a target weekday on or after `from`.
 * If `from` is already that weekday, advance to the *following* week's
 * occurrence to match the "next friday" / "this friday" semantics.
 */
function nextWeekday(from: Date, targetDay: number): Date {
  const current = from.getUTCDay();
  let diff = targetDay - current;
  if (diff <= 0) diff += 7;
  return addDays(from, diff);
}

/**
 * Strip the time portion, returning midnight UTC of the same calendar day.
 */
function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Detect time-bound expressions in a fact and compute an absolute expiry.
 *
 * @param factContent  - The extracted fact text
 * @param factTimestamp - ISO 8601 timestamp of the source conversation
 * @returns            - Temporal result with expiry if detected
 */
export function detectTemporalExpiry(factContent: string, factTimestamp: string): TemporalResult {
  const NO_MATCH: TemporalResult = {
    is_temporal: false,
    expires_at: null,
    temporal_expression: null,
  };

  const text = factContent.toLowerCase();
  const base = startOfDayUTC(new Date(factTimestamp));

  // Order matters: more specific patterns first to avoid partial matches.

  // --- "this weekend" ---
  if (/\bthis\s+weekend\b/.test(text)) {
    // Expire on the Monday after the upcoming weekend
    const monday = nextWeekday(base, 1); // next Monday
    return result(monday, 'this weekend');
  }

  // --- "next week" ---
  if (/\bnext\s+week\b/.test(text)) {
    return result(addDays(base, 14), 'next week');
  }

  // --- "this week" ---
  if (/\bthis\s+week\b/.test(text)) {
    return result(addDays(base, 7), 'this week');
  }

  // --- "next month" ---
  if (/\bnext\s+month\b/.test(text)) {
    const nextMonthIdx = base.getUTCMonth() + 2; // +1 for next, +1 because endOfMonth wants 1-indexed
    const year = nextMonthIdx > 12 ? base.getUTCFullYear() + 1 : base.getUTCFullYear();
    const month = nextMonthIdx > 12 ? nextMonthIdx - 12 : nextMonthIdx;
    return result(endOfMonth(year, month), 'next month');
  }

  // --- "this month" ---
  if (/\bthis\s+month\b/.test(text)) {
    return result(endOfMonth(base.getUTCFullYear(), base.getUTCMonth() + 1), 'this month');
  }

  // --- "tomorrow" ---
  if (/\btomorrow\b/.test(text)) {
    return result(addDays(base, 2), 'tomorrow');
  }

  // --- "today" / "tonight" ---
  if (/\b(today|tonight)\b/.test(text)) {
    return result(addDays(base, 1), text.match(/\b(today|tonight)\b/)![0]);
  }

  // --- "this <day>" / "next <day>" ---
  for (let i = 0; i < DAY_NAMES.length; i++) {
    const dayName = DAY_NAMES[i];
    const thisPattern = new RegExp(`\\bthis\\s+${dayName}\\b`);
    const nextPattern = new RegExp(`\\bnext\\s+${dayName}\\b`);

    if (thisPattern.test(text) || nextPattern.test(text)) {
      const target = nextWeekday(base, i);
      // Expire the day *after* the target day
      return result(addDays(target, 1), text.match(thisPattern)?.[0] || text.match(nextPattern)![0]);
    }
  }

  // --- "upcoming" ---
  if (/\bupcoming\b/.test(text)) {
    return result(addDays(base, 30), 'upcoming');
  }

  // --- "soon" ---
  if (/\bsoon\b/.test(text)) {
    return result(addDays(base, 14), 'soon');
  }

  return NO_MATCH;
}

function result(expiresAt: Date, expression: string): TemporalResult {
  return {
    is_temporal: true,
    expires_at: expiresAt.toISOString(),
    temporal_expression: expression,
  };
}
