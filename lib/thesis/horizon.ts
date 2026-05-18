export type HorizonState = "future" | "approaching" | "expired";

const APPROACHING_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  const horizon = new Date(timeHorizon);
  // Normalize both to UTC midnight so DST and intraday hours don't perturb
  // the day-count.
  const horizonDay = Date.UTC(
    horizon.getUTCFullYear(),
    horizon.getUTCMonth(),
    horizon.getUTCDate(),
  );
  const todayDay = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const diffDays = Math.round((horizonDay - todayDay) / MS_PER_DAY);

  if (diffDays < 0) return "expired";
  if (diffDays <= APPROACHING_DAYS) return "approaching";
  return "future";
}
