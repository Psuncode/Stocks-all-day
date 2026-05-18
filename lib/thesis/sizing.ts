export type SuggestedSharesInput = {
  entry: number;
  invalidationPrice: number;
  equity: number;
  riskPct: number;
};

/**
 * Fixed-fractional position sizing helper (requirements.md §B.6.1).
 *
 *   risk_dollars   = (riskPct / 100) × equity
 *   risk_distance  = entry - invalidationPrice
 *   suggested      = floor(risk_dollars / risk_distance)
 *
 * Returns 0 when the risk distance is non-positive — entry at or below the
 * invalidation price would imply negative risk and is not a valid setup.
 */
export function suggestedShares({
  entry,
  invalidationPrice,
  equity,
  riskPct,
}: SuggestedSharesInput): number {
  const riskDistance = entry - invalidationPrice;
  if (riskDistance <= 0) return 0;
  const riskDollars = (riskPct / 100) * equity;
  return Math.floor(riskDollars / riskDistance);
}
