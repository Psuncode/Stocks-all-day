import ScannerClient from "@/app/scanner/scanner-client";
import SectorHeatMap, { type SectorPerformance } from "@/components/SectorHeatMap";
import { getCachedUniverse } from "@/lib/data/cached-provider";
import type { UniverseSymbol } from "@/lib/types";

const SPARKLINE_LOOKBACK = 30;
const HEATMAP_LOOKBACK = 5;
const MIN_TICKERS_PER_SECTOR = 3;

function buildClosesByTicker(universe: UniverseSymbol[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const u of universe) {
    const candles = u.candles;
    if (!candles || candles.length === 0) continue;
    const start = Math.max(0, candles.length - SPARKLINE_LOOKBACK);
    const closes: number[] = [];
    for (let i = start; i < candles.length; i++) {
      closes.push(candles[i].c);
    }
    if (closes.length >= 2) out[u.meta.ticker.toUpperCase()] = closes;
  }
  return out;
}

function computeSectorPerformance(universe: UniverseSymbol[]): SectorPerformance[] {
  // Bucket by sector → list of 5-day returns
  const buckets = new Map<string, number[]>();
  for (const u of universe) {
    const sector = u.meta.sector;
    if (!sector) continue;
    const candles = u.candles;
    if (!candles || candles.length <= HEATMAP_LOOKBACK) continue;
    const last = candles[candles.length - 1].c;
    const past = candles[candles.length - 1 - HEATMAP_LOOKBACK].c;
    if (!Number.isFinite(last) || !Number.isFinite(past) || past <= 0) continue;
    const ret = last / past - 1;
    const arr = buckets.get(sector);
    if (arr) arr.push(ret);
    else buckets.set(sector, [ret]);
  }
  const out: SectorPerformance[] = [];
  for (const [sector, returns] of buckets) {
    if (returns.length < MIN_TICKERS_PER_SECTOR) continue;
    const sum = returns.reduce((a, b) => a + b, 0);
    out.push({
      sector,
      avgReturn5d: sum / returns.length,
      tickerCount: returns.length,
    });
  }
  return out;
}

export default async function ScannerPage() {
  // Prefetch universe once on the server. Already cached for 15 minutes
  // via getCachedUniverse(), so this is essentially free on warm cache.
  // We use it for two things on this page:
  //   1) Last-30 closes per ticker → sparkline data for the client
  //   2) 5-day sector performance for the heat map (server-rendered)
  let universe: UniverseSymbol[] = [];
  try {
    universe = await getCachedUniverse();
  } catch {
    // Soft-fail: the scanner client will still work via /api/scan; we
    // just won't have sparklines or a heat map on this load.
    universe = [];
  }

  const closesByTicker = buildClosesByTicker(universe);
  const sectorPerformance = computeSectorPerformance(universe);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-[family:var(--font-display)] text-2xl text-zinc-900">
          Scanner
        </h1>
        <div className="text-xs text-zinc-500 tabular-nums">
          $5–$100 · ADV$ ≥ $10M · spread ≤ 0.25%
        </div>
      </div>
      {sectorPerformance.length > 0 && (
        <div className="mt-4">
          <SectorHeatMap sectorPerformance={sectorPerformance} />
        </div>
      )}
      <div className="mt-4">
        <ScannerClient closesByTicker={closesByTicker} />
      </div>
    </main>
  );
}
