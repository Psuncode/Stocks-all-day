import { loadWatchlist } from "@/lib/thesis/load";
import { evaluateRule } from "@/lib/thesis/evaluate-rules";
import { daysUntil, horizonState } from "@/lib/thesis/horizon";
import { getCachedSymbol } from "@/lib/data/cached-provider";
import WatchlistView from "@/app/watchlist/watchlist-client";
import type { EnrichedEntry, FireRecord } from "@/app/watchlist/_thesis-card";

// Page itself is dynamic (per-request), but per-symbol data is cached at
// the call site via getCachedSymbol (15-min TTL).
export const dynamic = "force-dynamic";

// GSD review H3: cap the per-symbol fan-out so a 50-ticker watchlist
// doesn't try to make 50 simultaneous Yahoo calls on cold cache.
async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      result[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return result;
}

function priceProgress(
  entry: number,
  exit: number,
  current: number,
): number | null {
  // Only meaningful when entry < exit (long bias) and current within band.
  if (entry === exit) return null;
  const lo = Math.min(entry, exit);
  const hi = Math.max(entry, exit);
  if (current < lo || current > hi) return null;
  const pct = ((current - entry) / (exit - entry)) * 100;
  if (Number.isNaN(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}


export default async function WatchlistPage() {
  const { watchlist, errors } = await loadWatchlist();
  const today = new Date();

  const enriched: EnrichedEntry[] = await pMapLimit(
    watchlist.tickers,
    5,
    async (entry) => {
      let symbol = null;
      try {
        symbol = await getCachedSymbol(entry.ticker);
      } catch {
        symbol = null;
      }

      const lastPrice = symbol?.quote.last ?? null;

      const ruleEvaluations = entry.invalidation_rules.map((rule) => {
        const ev = symbol ? evaluateRule(rule, symbol.candles) : null;
        return {
          ruleId: rule.id,
          description: rule.description ?? rule.id,
          ev,
        };
      });

      const fires: FireRecord[] = ruleEvaluations
        .filter((re) => re.ev?.fired && !re.ev?.suppressed)
        .map((re) => ({
          ruleId: re.ruleId,
          description: re.description,
          observed: re.ev!.observed,
          threshold: re.ev!.threshold,
        }));

      let horizon: EnrichedEntry["horizon"] = null;
      if (entry.thesis) {
        const state = horizonState(entry.thesis.time_horizon, today);
        horizon = {
          date: entry.thesis.time_horizon,
          state,
          daysFromNow: daysUntil(entry.thesis.time_horizon, today),
        };
      }

      let progress: number | null = null;
      if (entry.thesis && lastPrice !== null) {
        progress = priceProgress(
          entry.thesis.entry_target,
          entry.thesis.exit_target,
          lastPrice,
        );
      }

      return {
        entry,
        available: symbol !== null,
        lastPrice,
        horizon,
        priceProgressPct: progress,
        fires,
        ruleEvaluations,
      };
    },
  );

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-800">
            Personal list
          </div>
          <h1 className="mt-2 font-[family:var(--font-display)] text-3xl text-zinc-900">
            Watchlist
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Source of truth: <code>data/watchlist.yaml</code>. Edit in the vault,
            push to git, refresh.
          </p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-3 text-xs text-zinc-500">
          Risk per trade: {watchlist.risk_pct}% · {watchlist.tickers.length}{" "}
          ticker{watchlist.tickers.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-8">
        <WatchlistView
          data={enriched}
          errors={errors}
          riskPct={watchlist.risk_pct}
        />
      </div>
    </main>
  );
}
