/**
 * Trade journal (v4.0 T3) — server component.
 *
 * Reads `loadJournal()` (failure-soft) and renders:
 *   - 4-up stats strip: closed N, win rate, avg R, total $ P&L
 *   - "Log new trade" expansion → client form
 *   - History table (lg+) / card grid (< lg)
 *   - By-setup breakdown panel (only when ≥1 trade has a setup)
 *
 * Mirrors the /digest layout pattern (stats on top, history below).
 * Mirrors the /watchlist KV-unavailable graceful-degrade pattern.
 */

import { loadJournal } from "@/lib/journal/archive";
import { loadWatchlist } from "@/lib/thesis/load";
import { kvAvailable } from "@/lib/data/kv";
import JournalClient from "./journal-client";
import type { TradeRecord, DerivedStats } from "@/lib/journal/schema";

export const dynamic = "force-dynamic";

const ZERO_STATS: DerivedStats = {
  n: 0,
  openN: 0,
  closedN: 0,
  closedWithRn: 0,
  winRate: 0,
  avgR: 0,
  totalPnL: 0,
  expectancy: 0,
  bySetup: {},
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function JournalPage() {
  const kvOn = kvAvailable();

  if (!kvOn) {
    return (
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
        <h1 className="font-[family:var(--font-display)] text-2xl text-zinc-900">
          Trade journal
        </h1>
        <div className="mt-6 rounded-[28px] border border-amber-200 bg-amber-50/70 p-6 text-sm text-amber-900">
          <div className="font-semibold">Journal backend not configured.</div>
          <p className="mt-2">
            Set <code>UPSTASH_REDIS_REST_URL</code> and{" "}
            <code>UPSTASH_REDIS_REST_TOKEN</code> in your Vercel project to enable
            persistence. See <code>KV-SETUP.md</code> for a 5-minute setup
            walkthrough.
          </p>
        </div>
      </main>
    );
  }

  // Pull trades + stats from KV (failure-soft inside loadJournal).
  let trades: TradeRecord[] = [];
  let stats: DerivedStats = ZERO_STATS;
  try {
    const result = await loadJournal();
    trades = result.trades;
    stats = result.stats;
  } catch (e) {
    console.error(`[journal] loadJournal failed: ${(e as Error).message}`);
  }

  // Active watchlist tickers — feed the form's thesis-link select.
  let activeTickers: string[] = [];
  try {
    const { watchlist } = await loadWatchlist();
    activeTickers = watchlist.tickers
      .filter((t) => t.status === "active")
      .map((t) => t.ticker)
      .sort();
  } catch {
    activeTickers = [];
  }

  const today = todayIso();
  const deleteEnabled = process.env.NEXT_PUBLIC_JOURNAL_DELETE === "1";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-800">
            Decision record
          </div>
          <h1 className="mt-2 font-[family:var(--font-display)] text-3xl text-zinc-900">
            Trade journal
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Log every trade. Win rate, average R, and $ P&L are computed at read
            time. Trades update live.
          </p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-3 text-xs text-zinc-500 tabular-nums">
          {stats.n} trade{stats.n === 1 ? "" : "s"} · {stats.openN} open
        </div>
      </div>

      {/* Stats strip — 4 cells */}
      <StatsStrip stats={stats} />

      {/* Add/edit client island — also renders the history list */}
      <div className="mt-6">
        <JournalClient
          initialTrades={trades}
          today={today}
          activeTickers={activeTickers}
          deleteEnabled={deleteEnabled}
        />
      </div>

      {/* By-setup breakdown — only when there's something to show */}
      <SetupBreakdown stats={stats} />
    </main>
  );
}

function StatsStrip({ stats }: { stats: DerivedStats }) {
  const winPct =
    stats.closedWithRn === 0 ? null : Math.round(stats.winRate * 100);
  const avgRTone =
    stats.closedWithRn === 0
      ? "text-zinc-500"
      : stats.avgR > 0
        ? "text-emerald-700"
        : "text-red-700";
  const pnlTone =
    stats.closedN === 0
      ? "text-zinc-500"
      : stats.totalPnL > 0
        ? "text-emerald-700"
        : stats.totalPnL < 0
          ? "text-red-700"
          : "text-zinc-700";

  return (
    <section className="mt-6 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
      <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
        Performance (all closed trades)
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCell label="Closed" value={`${stats.closedN}`} tone="text-zinc-900" />
        <StatCell
          label="Win rate"
          value={winPct == null ? "—" : `${winPct}%`}
          sub={
            stats.closedWithRn === 0
              ? "no R data"
              : `n=${stats.closedWithRn}`
          }
          tone={
            winPct == null
              ? "text-zinc-500"
              : winPct >= 50
                ? "text-emerald-700"
                : "text-red-700"
          }
        />
        <StatCell
          label="Avg R"
          value={
            stats.closedWithRn === 0
              ? "—"
              : `${stats.avgR >= 0 ? "+" : ""}${stats.avgR.toFixed(2)}R`
          }
          sub={
            stats.closedWithRn === 0
              ? "needs stop or thesis"
              : `n=${stats.closedWithRn}`
          }
          tone={avgRTone}
        />
        <StatCell
          label="Total $ P&L"
          value={
            stats.closedN === 0
              ? "—"
              : `${stats.totalPnL >= 0 ? "+" : "-"}$${Math.abs(
                  stats.totalPnL,
                ).toFixed(0)}`
          }
          sub={stats.closedN === 0 ? "no closed" : `${stats.closedN} closed`}
          tone={pnlTone}
        />
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-zinc-500 tabular-nums">{sub}</div>
      ) : null}
    </div>
  );
}

function SetupBreakdown({ stats }: { stats: DerivedStats }) {
  const entries = Object.entries(stats.bySetup).filter(
    ([, s]) => s.n > 0,
  );
  if (entries.length === 0) return null;

  // Sort by trade count desc
  entries.sort((a, b) => b[1].n - a[1].n);

  return (
    <section className="mt-8 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
      <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
        Breakdown by setup
      </div>
      <div className="mt-3 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="border-b px-3 py-2">Setup</th>
              <th className="border-b px-3 py-2 text-right tabular-nums">N</th>
              <th className="border-b px-3 py-2 text-right tabular-nums">
                Win rate
              </th>
              <th className="border-b px-3 py-2 text-right tabular-nums">
                Avg R
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, s]) => {
              const label = key === "UNSET" ? "—" : key.toLowerCase().replace("_", " ");
              const rTone =
                s.avgR > 0
                  ? "text-emerald-700"
                  : s.avgR < 0
                    ? "text-red-700"
                    : "text-zinc-700";
              return (
                <tr key={key} className="text-sm">
                  <td className="border-b px-3 py-2 text-zinc-800">{label}</td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {s.n}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {s.winRate === 0 && s.avgR === 0
                      ? "—"
                      : `${Math.round(s.winRate * 100)}%`}
                  </td>
                  <td
                    className={`border-b px-3 py-2 text-right tabular-nums ${rTone}`}
                  >
                    {s.winRate === 0 && s.avgR === 0
                      ? "—"
                      : `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Win rate and avg R use closed trades only with a resolvable stop
        (explicit or linked thesis invalidation).
      </p>
    </section>
  );
}

