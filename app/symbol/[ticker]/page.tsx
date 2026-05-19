import Link from "next/link";
import { Badge } from "@/components/Badge";
import { GateBreakdown } from "@/components/GateBreakdown";
import { PriceChart } from "@/components/PriceChart";
import { GeminiExplain } from "@/app/symbol/[ticker]/gemini-explain";
import {
  getCachedSymbol,
  getCachedUniverse,
  getCachedSpy,
} from "@/lib/data/cached-provider";
import {
  buildSectorRsMap,
  evaluateSymbol,
  todayYmd,
} from "@/lib/engine/evaluate";
import { loadWatchlist } from "@/lib/thesis/load";
import { daysUntil, horizonState } from "@/lib/thesis/horizon";
import type { HorizonState } from "@/lib/thesis/horizon";
import { suggestedShares } from "@/lib/thesis/sizing";
import type { TickerEntry } from "@/lib/thesis/schema";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat("en-US");

function horizonTone(state: HorizonState): "neutral" | "watch" | "block" {
  if (state === "expired") return "block";
  if (state === "approaching") return "watch";
  return "neutral";
}

function ConfidenceDots({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, value));
  return (
    <span className="tabular-nums" aria-label={`Confidence ${filled} of 5`}>
      <span className="text-emerald-700">{"●".repeat(filled)}</span>
      <span className="text-zinc-300">{"○".repeat(5 - filled)}</span>
      <span className="ml-2 text-zinc-500">({filled}/5)</span>
    </span>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-dashed border-zinc-200 py-2 text-sm last:border-b-0">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="text-right font-medium text-zinc-900">{children}</span>
    </div>
  );
}

function decisionTone(d: string) {
  if (d === "TRADE") return "trade" as const;
  if (d === "WATCH") return "watch" as const;
  return "block" as const;
}

function formatMillions(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export default async function SymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ allowEarnings?: string }>;
}) {
  const { ticker } = await params;
  const sp = await searchParams;
  const allowEarnings = sp.allowEarnings === "1" || sp.allowEarnings === "true";

  const [universe, spy, symbol, watchlistResult] = await Promise.all([
    getCachedUniverse(),
    getCachedSpy(),
    getCachedSymbol(ticker),
    loadWatchlist(),
  ]);

  if (!symbol) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold">Not found</div>
          <div className="mt-2 text-sm text-zinc-600">
            No symbol named &quot;{ticker}&quot;.
          </div>
          <div className="mt-4">
            <Link
              className="text-sm font-medium text-emerald-800 hover:underline"
              href="/scanner"
            >
              Back to scanner
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // GSD review pass 2 H3.5: precompute sector RS once so this page load
  // doesn't repeat O(N × peers) deriveMetrics during the EVENT gate.
  const sectorRsByName = buildSectorRsMap(universe, spy);
  const result = evaluateSymbol(
    symbol,
    universe,
    { allowEarningsTrades: allowEarnings },
    todayYmd(),
    spy,
    sectorRsByName,
  );

  const watchEntry: TickerEntry | undefined =
    watchlistResult.watchlist.tickers.find(
      (t) => t.ticker.toUpperCase() === ticker.toUpperCase(),
    );
  const riskPct = watchlistResult.watchlist.risk_pct;
  const accountEquity = Number(process.env.ACCOUNT_EQUITY_USD ?? 33000);

  const thesis = watchEntry?.thesis;
  const thesisHorizon: HorizonState | undefined = thesis
    ? horizonState(thesis.time_horizon)
    : undefined;
  const thesisDays = thesis ? daysUntil(thesis.time_horizon) : 0;
  const thesisShares = thesis
    ? suggestedShares({
        entry: thesis.entry_target,
        invalidationPrice: thesis.invalidation_price,
        equity: accountEquity,
        riskPct,
      })
    : 0;
  const tagMismatch = Boolean(
    thesis?.setup_tag &&
      result.gateSummary.setup !== "NONE" &&
      thesis.setup_tag.toUpperCase() !== result.gateSummary.setup,
  );

  const chartCandles = symbol.candles
    .slice(-120)
    .map((c) => ({ t: c.t, c: c.c }));
  const history = symbol.candles.slice(-252);
  const closes = history.map((c) => c.c);
  const lastClose = closes[closes.length - 1] ?? result.metrics.price;
  const high52 = closes.length ? Math.max(...closes) : lastClose;
  const low52 = closes.length ? Math.min(...closes) : lastClose;
  const fromHigh = high52 ? ((lastClose - high52) / high52) * 100 : 0;
  const fromLow = low52 ? ((lastClose - low52) / low52) * 100 : 0;

  // Today's move for the inline price line
  const prevClose = closes[closes.length - 2] ?? lastClose;
  const todayPct = ((lastClose - prevClose) / Math.max(0.01, prevClose)) * 100;
  const todayUp = todayPct >= 0;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8">
      {/* Hero header. GSD UI review pass 2 H4: at 375px the previous
          flex-wrap put decision badge + reason alongside a 4xl ticker
          and wrapped to 4 lines. Now: ticker block stays compact on
          mobile (3xl, name truncates), decision sits BELOW the ticker
          block on phone and beside on lg+. */}
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-[family:var(--font-display)] text-3xl text-zinc-900 md:text-4xl">
              {result.ticker}
            </h1>
            <span className="truncate text-base text-zinc-500 md:text-lg">
              {result.name}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-zinc-600">
            <span>{result.sector}</span>
            <span className="tabular-nums">
              {usd.format(result.metrics.price)}
            </span>
            <span
              className={`tabular-nums ${todayUp ? "text-emerald-700" : "text-red-700"}`}
            >
              {todayUp ? "▲" : "▼"} {Math.abs(todayPct).toFixed(2)}% today
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <Badge tone={decisionTone(result.decision)}>{result.decision}</Badge>
          <span className="text-sm text-zinc-600 md:max-w-md">
            {result.reason}
          </span>
        </div>
      </div>

      {/* Stat strip — compact */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Spread" value={`${result.metrics.spreadPct.toFixed(3)}%`} />
        <Stat label="ADV $" value={formatMillions(result.metrics.advUsd)} />
        <Stat label="ATR" value={`${result.metrics.atrPct.toFixed(2)}%`} />
        <Stat
          label="52W range"
          value={`${usd.format(low52)} – ${usd.format(high52)}`}
          hint={`${fromLow >= 0 ? "+" : ""}${fromLow.toFixed(1)}% / ${fromHigh.toFixed(1)}%`}
        />
      </div>

      {/* Hero chart — full width, no side aside */}
      <section className="mt-6 rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">
            Price action · last 120 sessions
          </h2>
          <div className="text-xs text-zinc-500">
            Entry / Stop / Target overlay shown when actionable
          </div>
        </div>
        <div className="mt-4">
          <PriceChart
            candles={chartCandles}
            entryPrice={result.plan?.entry}
            stopPrice={result.plan?.stop}
            targetPrice={result.plan?.target}
            variant="plain"
          />
        </div>
      </section>

      {/* Plan + Thesis row */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">Trade plan</h2>
            <Badge tone={decisionTone(result.decision)}>{result.decision}</Badge>
          </div>
          {result.plan ? (
            <div className="mt-4 space-y-1">
              <Row label="Entry">
                <span className="tabular-nums">
                  {usd.format(result.plan.entry)}
                </span>
              </Row>
              <Row label="Stop">
                <span className="tabular-nums">
                  {usd.format(result.plan.stop)}
                </span>
              </Row>
              <Row label="Target">
                <span className="tabular-nums">
                  {usd.format(result.plan.target)}
                </span>
              </Row>
              <Row label="Risk / reward">
                <span className="tabular-nums">{result.plan.rr}x</span>
              </Row>
              <Row label="Est. hold">{result.plan.estHold}</Row>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-white/40 p-4 text-sm text-zinc-600">
              No actionable plan — setup hasn&apos;t triggered. Watching for
              confirmation.
            </div>
          )}
          <div className="mt-4 text-xs text-zinc-500">
            Earnings flag is{" "}
            <span className="font-semibold uppercase tracking-wide">
              {allowEarnings ? "ON" : "OFF"}
            </span>
            .{" "}
            <Link
              className="text-emerald-800 hover:underline"
              href={`/symbol/${encodeURIComponent(result.ticker)}?allowEarnings=${allowEarnings ? "0" : "1"}`}
            >
              Toggle
            </Link>
          </div>
        </section>

        {thesis ? (
          <section className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-zinc-900">Thesis</h2>
              <Badge tone="info">
                Watchlist · {watchEntry?.status ?? "active"}
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-700">
              {thesis.summary}
            </p>

            <div className="mt-4 grid gap-2 rounded-2xl border border-zinc-200 bg-white/60 p-3 sm:grid-cols-2">
              <div>
                <div className="font-medium tabular-nums text-zinc-900">
                  Stop{" "}
                  {result.plan?.stop != null
                    ? usd.format(result.plan.stop)
                    : "—"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  engine · where I cut risk
                </div>
              </div>
              <div>
                <div className="font-medium tabular-nums text-zinc-900">
                  Invalidation {usd.format(thesis.invalidation_price)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  you · where I was wrong
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1">
              <Row label="Setup tag">
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <span>{thesis.setup_tag ?? "—"}</span>
                  {tagMismatch ? (
                    <Badge tone="watch">
                      Engine sees: {result.gateSummary.setup}
                    </Badge>
                  ) : null}
                </span>
              </Row>
              {typeof thesis.confidence === "number" ? (
                <Row label="Confidence">
                  <ConfidenceDots value={thesis.confidence} />
                </Row>
              ) : null}
              <Row label="Targets">
                <span className="tabular-nums">
                  {usd.format(thesis.entry_target)} →{" "}
                  {usd.format(thesis.exit_target)}
                </span>
              </Row>
              <Row label="Suggested shares">
                <span className="tabular-nums">
                  {intFmt.format(thesisShares)} · {riskPct}% risk
                </span>
              </Row>
              <Row label="Horizon">
                {thesisHorizon ? (
                  <Badge tone={horizonTone(thesisHorizon)}>
                    {thesis.time_horizon}
                    {" · "}
                    {thesisDays >= 0
                      ? `${thesisDays}d left`
                      : `${Math.abs(thesisDays)}d ago`}
                  </Badge>
                ) : (
                  "—"
                )}
              </Row>
            </div>

            {thesis.catalysts.length > 0 ? (
              <div className="mt-4 text-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Catalysts
                </div>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-zinc-700">
                  {thesis.catalysts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : watchEntry ? (
          <section className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-zinc-900">Thesis</h2>
              <Badge tone="soft">Watchlist · {watchEntry.status}</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600">
              Watchlist status:{" "}
              <span className="font-medium text-zinc-800">
                {watchEntry.status}
              </span>
              . Add a thesis in{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
                data/watchlist.yaml
              </code>{" "}
              to populate this panel.
            </p>
          </section>
        ) : (
          <section className="rounded-[28px] border border-dashed border-zinc-200 bg-white/40 p-6 text-sm text-zinc-600">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Not on watchlist
            </div>
            <p className="mt-2 leading-relaxed">
              This ticker isn&apos;t in your watchlist. Add it in{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
                data/watchlist.yaml
              </code>{" "}
              to attach a thesis and start tracking invalidations.
            </p>
          </section>
        )}
      </div>

      {/* Quick stats */}
      <section className="mt-6 rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Context</h2>
        <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Row label="Relative strength vs SPY (60d)">
            <span className="tabular-nums">
              {result.metrics.rs60.toFixed(2)}
            </span>
          </Row>
          <Row label="Earnings date">{symbol.earningsDate ?? "—"}</Row>
          <Row label="Catalyst flag">
            {symbol.hasCatalyst ? "Present" : "None"}
          </Row>
          <Row label="Trend / vol / liquidity">
            <span className="text-xs">
              {result.gateSummary.trend} · {result.gateSummary.vol} ·{" "}
              {result.gateSummary.liquidity}
            </span>
          </Row>
        </div>
      </section>

      {/* Why this decision — gate-by-gate */}
      <section className="mt-6 rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">
          Why this decision
        </h2>
        <div className="mt-3 text-sm text-zinc-600">
          Six gates. First BLOCK wins.
        </div>
        <div className="mt-4">
          <GateBreakdown gates={result.gates} />
        </div>
      </section>

      {/* Gemini explanation — bottom, optional */}
      <section className="mt-6">
        <GeminiExplain result={result} />
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-zinc-900">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>
      ) : null}
    </div>
  );
}
