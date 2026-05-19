/**
 * Daily top-5 digest builder (Feature D — requirements.md §10.5).
 *
 * Runs the engine over the full screener universe at cron time, picks 5
 * candidates ranked by TRADE-before-WATCH, then R:R desc, then ADV$ desc.
 * Returns the picks plus last-90-day close arrays for chart rendering.
 *
 * Performance: the full universe scan exceeds the 10s Vercel hobby default,
 * so the calling route declares `export const maxDuration = 60`.
 */

import { getProvider } from "@/lib/data/provider";
import { runScan } from "@/lib/engine/scan";
import { fetchSpyCandles } from "@/lib/data/yahoo";
import type { DecisionResult, ScanConfig } from "@/lib/types";
import { buildNarrative } from "@/lib/digest/narrative";

export type DigestPick = {
  result: DecisionResult;
  // Last ~90 daily closes for the chart. Plain `{t,c}` pairs to keep the
  // payload small when this object crosses module boundaries.
  candles: Array<{ t: string; c: number }>;
  // Pre-built per-pick narrative (Slack digest description). Computed at
  // build time when we still have the full candle (with volume + OHL).
  narrative: string;
};

const TOP_N = 5;

const DIGEST_CFG: ScanConfig = {
  includeBlocked: false,
  allowEarningsTrades: false,
  decisionFilter: "ALL",
  whyBlockedOnly: false,
  maxRows: 0,
};

export async function buildDigest(): Promise<DigestPick[]> {
  const provider = getProvider();
  let universe;
  let spy;
  try {
    [universe, spy] = await Promise.all([
      provider.getUniverse(),
      fetchSpyCandles(),
    ]);
  } catch (e) {
    console.warn(`[digest] universe/spy fetch failed: ${(e as Error).message}`);
    return [];
  }

  if (universe.length === 0) {
    console.warn("[digest] universe empty — skipping");
    return [];
  }

  const results = runScan(universe, DIGEST_CFG, spy);
  const candidates = results.filter(
    (r) => r.decision === "TRADE" || r.decision === "WATCH",
  );

  candidates.sort((a, b) => {
    // Decision tier first: TRADE before WATCH.
    if (a.decision !== b.decision) {
      return a.decision === "TRADE" ? -1 : 1;
    }
    // Within a tier, bias toward 3W momentum (high vol + tracking SMA15).
    if (a.metrics.sustainedHighVol !== b.metrics.sustainedHighVol) {
      return a.metrics.sustainedHighVol ? -1 : 1;
    }
    // Then R:R, then ADV$ — both descending.
    const aRr = a.plan?.rr ?? 0;
    const bRr = b.plan?.rr ?? 0;
    if (aRr !== bRr) return bRr - aRr;
    return b.metrics.advUsd - a.metrics.advUsd;
  });

  const top = candidates.slice(0, TOP_N);

  // Attach 90d candle history per pick. The universe array already has candles
  // loaded, so this is a constant-time lookup, not another fetch.
  const universeByTicker = new Map(universe.map((u) => [u.meta.ticker, u]));
  return top.map((result) => {
    const sym = universeByTicker.get(result.ticker);
    const fullCandles = sym?.candles ?? [];
    const candles = fullCandles.slice(-90).map((c) => ({ t: c.t, c: c.c }));
    const narrative = buildNarrative(result, fullCandles);
    return { result, candles, narrative };
  });
}
