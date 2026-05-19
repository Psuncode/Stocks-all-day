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
import { preferenceScore } from "@/lib/preferences";

export type DigestPick = {
  result: DecisionResult;
  candles: Array<{ t: string; c: number }>;
  narrative: string;
};

export type DigestResult = {
  picks: DigestPick[];
  topPick: DigestPick | null;
};

const TOP_N = 5;

const DECISION_ORDER: Record<string, number> = { TRADE: 0, WATCH: 1, PASS: 2 };

const DIGEST_CFG: ScanConfig = {
  includeBlocked: false,
  allowEarningsTrades: false,
  decisionFilter: "ALL",
  whyBlockedOnly: false,
  maxRows: 0,
};

function compareForDigest(a: DecisionResult, b: DecisionResult): number {
  const dord =
    (DECISION_ORDER[a.decision] ?? 99) - (DECISION_ORDER[b.decision] ?? 99);
  if (dord !== 0) return dord;
  if (a.metrics.sustainedHighVol !== b.metrics.sustainedHighVol) {
    return a.metrics.sustainedHighVol ? -1 : 1;
  }
  const aPref = preferenceScore({ ticker: a.ticker, sector: a.sector });
  const bPref = preferenceScore({ ticker: b.ticker, sector: b.sector });
  if (aPref !== bPref) return bPref - aPref;
  const aRr = a.plan?.rr ?? 0;
  const bRr = b.plan?.rr ?? 0;
  if (aRr !== bRr) return bRr - aRr;
  return b.metrics.advUsd - a.metrics.advUsd;
}

export async function buildDigest(): Promise<DigestResult> {
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
    return { picks: [], topPick: null };
  }

  if (universe.length === 0) {
    console.warn("[digest] universe empty — skipping");
    return { picks: [], topPick: null };
  }

  const results = runScan(universe, DIGEST_CFG, spy);
  const allRanked = [...results].sort(compareForDigest);
  const tradeWatch = allRanked.filter(
    (r) => r.decision === "TRADE" || r.decision === "WATCH",
  );

  const universeByTicker = new Map(universe.map((u) => [u.meta.ticker, u]));
  const attach = (result: DecisionResult): DigestPick => {
    const sym = universeByTicker.get(result.ticker);
    const fullCandles = sym?.candles ?? [];
    const candles = fullCandles.slice(-90).map((c) => ({ t: c.t, c: c.c }));
    const narrative = buildNarrative(result, fullCandles);
    return { result, candles, narrative };
  };

  const picks = tradeWatch.slice(0, TOP_N).map(attach);
  const topPick = allRanked.length > 0 ? attach(allRanked[0]!) : null;
  return { picks, topPick };
}
