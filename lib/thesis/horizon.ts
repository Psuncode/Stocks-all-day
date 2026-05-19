export type HorizonState = "future" | "approaching" | "expired";

const APPROACHING_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole-day delta from today to an ISO date, normalized to UTC midnight on
 * both ends so DST and intraday hours don't perturb the count.
 * Positive = future, negative = past. GSD review M9.
 */
export function daysUntil(iso: string, today: Date = new Date()): number {
  return Math.round((utcDay(new Date(iso)) - utcDay(today)) / MS_PER_DAY);
}

/**
 * Computes the state of a thesis time horizon vs. a reference date.
 *
 * - `expired` if the horizon date is in the past (strictly before today).
 * - `approaching` if the horizon is within the next 14 days (inclusive).
 * - `future` otherwise.
 *
 * Per requirements.md §B.1.3-§B.1.4, this state is computed at evaluation
 * time and never stored.
 */
export function horizonState(
  timeHorizon: string,
  today: Date = new Date(),
): HorizonState {
  const diffDays = daysUntil(timeHorizon, today);
  if (diffDays < 0) return "expired";
  if (diffDays <= APPROACHING_DAYS) return "approaching";
  return "future";
}
