import Link from "next/link";
import { Badge } from "@/components/Badge";
import { GateBreakdown } from "@/components/GateBreakdown";
import { PriceChart } from "@/components/PriceChart";
import { GeminiExplain } from "@/app/symbol/[ticker]/gemini-explain";
import { getProvider } from "@/lib/data/provider";
import { evaluateSymbol, todayYmd } from "@/lib/engine/evaluate";
import { fetchSpyCandles } from "@/lib/data/yahoo";

function decisionTone(d: string) {
  if (d === "TRADE") return "trade" as const;
  if (d === "WATCH") return "watch" as const;
  return "block" as const;
}

function formatMillions(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-zinc-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-zinc-200 py-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-900">{value}</span>
    </div>
  );
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

  const provider = getProvider();
  const [universe, spy, symbol] = await Promise.all([
    provider.getUniverse(),
    fetchSpyCandles(),
    provider.getSymbol(ticker),
  ]);

  if (!symbol) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold">Not found</div>
          <div className="mt-2 text-sm text-zinc-600">No symbol named &quot;{ticker}&quot;.</div>
          <div className="mt-4">
            <Link className="text-sm font-medium text-emerald-800 hover:underline" href="/scanner">
              Back to scanner
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const result = evaluateSymbol(symbol, universe, { allowEarningsTrades: allowEarnings }, todayYmd(), spy);
  const chartCandles = symbol.candles.slice(-120).map((c) => ({ t: c.t, c: c.c }));
  const history = symbol.candles.slice(-252);
  const closes = history.map((c) => c.c);
  const lastClose = closes[closes.length - 1] ?? result.metrics.price;
  const high52 = closes.length ? Math.max(...closes) : lastClose;
  const low52 = closes.length ? Math.min(...closes) : lastClose;
  const fromHigh = high52 ? ((lastClose - high52) / high52) * 100 : 0;
  const fromLow = low52 ? ((lastClose - low52) / low52) * 100 : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-800">Swing Workspace</div>
          <h1 className="font-[family:var(--font-display)] text-3xl text-zinc-900">
            {result.ticker} · {result.name}
          </h1>
          <div className="text-sm text-zinc-500">{result.sector}</div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <Badge tone="info">Live</Badge>
            <span>
              Last refresh{" "}
              {new Date(result.updatedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span>Universe: {universe.length} names</span>
          </div>
        </div>
        <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 text-right shadow-sm">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decision</div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Badge tone={decisionTone(result.decision)}>{result.decision}</Badge>
            <span className="text-xs text-zinc-600">{result.reason}</span>
          </div>
          <div className="mt-3 text-xs text-zinc-500">Allow earnings: {allowEarnings ? "ON" : "OFF"}</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        <StatCard label="Price" value={`$${result.metrics.price.toFixed(2)}`} hint="Last close" />
        <StatCard label="Spread" value={`${result.metrics.spreadPct.toFixed(3)}%`} hint="Bid/ask" />
        <StatCard label="ADV $" value={formatMillions(result.metrics.advUsd)} hint="3M avg" />
        <StatCard label="ATR" value={`${result.metrics.atrPct.toFixed(2)}%`} hint="14d volatility" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="space-y-6">
          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Market tape</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">Price action & context</div>
              </div>
              <div className="text-xs text-zinc-500">120 trading days</div>
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
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Overview</div>
              <div className="mt-4 space-y-2 text-sm">
                <InfoRow label="52W high" value={`$${high52.toFixed(2)} (${fromHigh.toFixed(1)}%)`} />
                <InfoRow label="52W low" value={`$${low52.toFixed(2)} (${fromLow.toFixed(1)}%)`} />
                <InfoRow label="Relative strength" value={`${result.metrics.rs60.toFixed(2)} slope`} />
                <InfoRow label="Earnings" value={symbol.earningsDate ?? "No date"} />
                <InfoRow label="Catalyst" value={symbol.hasCatalyst ? "Present" : "None"} />
              </div>
            </div>
            <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Trade plan</div>
              {result.plan ? (
                <div className="mt-4 space-y-3 text-sm">
                  <InfoRow label="Entry" value={String(result.plan.entry)} />
                  <InfoRow label="Stop" value={String(result.plan.stop)} />
                  <InfoRow label="Target" value={String(result.plan.target)} />
                  <InfoRow label="Risk/Reward" value={`${result.plan.rr}x`} />
                  <InfoRow label="Est. hold" value={result.plan.estHold} />
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-600">
                  No trade plan is shown unless the setup qualifies as TRADE.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Fundamentals</div>
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">
              <div className="font-medium text-zinc-700">On the roadmap</div>
              <div className="mt-2 leading-relaxed">
                Fundamental data — P/E, market cap, EV/EBITDA, revenue growth, and margins — is planned for a future release. This engine is currently optimized for technical price structure and momentum signals.
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Catalysts</div>
            <div className="mt-4 space-y-3 text-sm text-zinc-600">
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-3">
                Add earnings call, guidance changes, or news catalysts here.
              </div>
              <Link
                className="inline-flex items-center text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800"
                href={`/symbol/${encodeURIComponent(result.ticker)}?allowEarnings=${allowEarnings ? "0" : "1"}`}
              >
                Toggle earnings trades
              </Link>
            </div>
          </div>

          <GeminiExplain result={result} />

          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Gate breakdown</div>
            <div className="mt-3">
              <GateBreakdown gates={result.gates} />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 text-sm text-zinc-600 shadow-sm">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Reminder</div>
            <div className="mt-3">This demo is designed to help you trade less, with cleaner context.</div>
            <div className="mt-2 text-xs text-zinc-400">Not investment advice.</div>
          </div>
        </aside>
      </div>
    </main>
  );
}
