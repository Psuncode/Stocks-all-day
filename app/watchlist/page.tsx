import Link from "next/link";
import { loadWatchlist } from "@/lib/thesis/load";
import { evaluateRule } from "@/lib/thesis/evaluate-rules";
import { daysUntil, horizonState } from "@/lib/thesis/horizon";
import { getCachedSymbol } from "@/lib/data/cached-provider";
import WatchlistView from "@/app/watchlist/watchlist-client";
import type { EnrichedEntry, FireRecord } from "@/app/watchlist/_thesis-card";
import { listQuickWatch, type QuickWatchEntry } from "@/lib/watch/quick-watch";
import { kvAvailable } from "@/lib/data/kv";
import { Badge } from "@/components/Badge";

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

      {/* Feature F — quick watch section (KV-backed). Rendered after the
          YAML-driven view so thesis entries stay primary. */}
      <QuickWatchSection />
    </main>
  );
}

async function QuickWatchSection() {
  if (!kvAvailable()) return null;
  const entries = await listQuickWatch();
  if (entries.length === 0) {
    return (
      <section className="mt-10 rounded-[28px] border border-dashed border-zinc-200 bg-white/40 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-[family:var(--font-display)] text-xl text-zinc-900">
            Quick watch
          </h2>
          <span className="text-xs text-zinc-500">empty</span>
        </div>
        <p className="mt-2 text-sm text-zinc-600">
          Tap the 👁 button on a row in{" "}
          <Link href="/scanner" className="text-emerald-800 underline">
            Scanner
          </Link>{" "}
          to drop tickers here. Lighter than the thesis-driven list above;
          no entry/exit required.
        </p>
      </section>
    );
  }

  const enriched = await pMapLimit(entries, 5, async (entry) => {
    let lastPrice: number | null = null;
    try {
      const sym = await getCachedSymbol(entry.ticker);
      lastPrice = sym?.quote.last ?? null;
    } catch {
      // ignore
    }
    return { entry, lastPrice };
  });

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-[family:var(--font-display)] text-xl text-zinc-900">
          Quick watch
        </h2>
        <span className="text-xs text-zinc-500 tabular-nums">
          {entries.length} ticker{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Tapped from the scanner. No thesis required.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {enriched.map(({ entry, lastPrice }) => (
          <QuickWatchCard key={entry.ticker} entry={entry} lastPrice={lastPrice} />
        ))}
      </div>
    </section>
  );
}

function QuickWatchCard({
  entry,
  lastPrice,
}: {
  entry: QuickWatchEntry;
  lastPrice: number | null;
}) {
  const added = new Date(entry.added_at);
  const addedStr = isNaN(added.getTime())
    ? entry.added_at.slice(0, 10)
    : added.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

  return (
    <Link
      href={`/symbol/${encodeURIComponent(entry.ticker)}`}
      className="block rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm transition-colors hover:bg-white"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-zinc-900">{entry.ticker}</div>
          <div className="truncate text-xs text-zinc-500">
            {entry.sector} · {entry.name}
          </div>
        </div>
        {entry.decision_at_add !== "—" ? (
          <Badge
            tone={
              entry.decision_at_add === "TRADE"
                ? "trade"
                : entry.decision_at_add === "WATCH"
                  ? "watch"
                  : "neutral"
            }
          >
            {entry.decision_at_add}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-600 tabular-nums">
        <span>
          {lastPrice != null ? `$${lastPrice.toFixed(2)}` : "—"} · added {addedStr}
        </span>
        {entry.setup_at_add !== "NONE" ? (
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            {entry.setup_at_add.toLowerCase().replace("_", " ")}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
