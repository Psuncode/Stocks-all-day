"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Badge } from "@/components/Badge";
import type { Decision, DecisionResult } from "@/lib/types";

const STORAGE_KEY = "swing.watchlist.v1";

type EvaluateResponse = {
  results: DecisionResult[];
  notFound: string[];
  generatedAt: string;
};

function decisionTone(d: Decision) {
  if (d === "TRADE") return "trade" as const;
  if (d === "WATCH") return "watch" as const;
  return "block" as const;
}

function rowBg(d: Decision | undefined) {
  if (d === "TRADE") return "bg-green-50/40 hover:bg-green-50";
  if (d === "WATCH") return "bg-amber-50/30 hover:bg-amber-50/60";
  return "hover:bg-zinc-50";
}

function cardBg(d: Decision | undefined) {
  if (d === "TRADE") return "bg-green-50/40 border-green-100";
  if (d === "WATCH") return "bg-amber-50/30 border-amber-100";
  return "bg-white border-zinc-100";
}

function normalizeTicker(t: string) {
  return t.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}

function parseTickers(input: string) {
  return input
    .split(/[\s,]+/g)
    .map(normalizeTicker)
    .filter(Boolean);
}

export default function WatchlistClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [bulk, setBulk] = useState("");
  const [allowEarnings, setAllowEarnings] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EvaluateResponse | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const tickersRaw = (parsed as any)?.tickers;
      if (Array.isArray(tickersRaw)) {
        const cleaned = tickersRaw
          .map((t: any) => (typeof t === "string" ? normalizeTicker(t) : ""))
          .filter(Boolean);
        setTickers(Array.from(new Set<string>(cleaned)).slice(0, 200));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tickers }));
    } catch {
      // ignore
    }
  }, [tickers]);

  const sortedTickers = useMemo(() => [...tickers].sort(), [tickers]);

  async function refresh() {
    if (sortedTickers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tickers: sortedTickers, allowEarnings }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || `Request failed (${res.status})`);
      }
      const json = (await res.json()) as EvaluateResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function addOne() {
    const t = normalizeTicker(draft);
    if (!t) return;
    setTickers((prev) => Array.from(new Set([...prev, t])).slice(0, 200));
    setDraft("");
  }

  function addBulk() {
    const list = parseTickers(bulk);
    if (list.length === 0) return;
    setTickers((prev) => Array.from(new Set([...prev, ...list])).slice(0, 200));
    setBulk("");
  }

  function removeTicker(t: string) {
    setTickers((prev) => prev.filter((x) => x !== t));
  }

  const resultsByTicker = useMemo(() => {
    const m = new Map<string, DecisionResult>();
    for (const r of data?.results ?? []) m.set(r.ticker.toUpperCase(), r);
    return m;
  }, [data]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      <section className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
        <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Tickers</div>

        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. ALGN"
            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
          />
          <button
            onClick={addOne}
            className="shrink-0 rounded-full bg-emerald-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-200/50 transition-colors hover:bg-emerald-800"
          >
            Add
          </button>
        </div>

        <div className="mt-3">
          <div className="text-xs font-semibold text-zinc-900">Bulk import</div>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder="Paste tickers separated by commas / spaces / newlines"
            className="mt-1 h-24 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={addBulk}
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600"
            >
              Import
            </button>
            <button
              onClick={() => setTickers([])}
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/70 bg-white/70 p-3">
          <div className="text-xs font-semibold text-zinc-900">Earnings (default: off)</div>
          <label className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="text-zinc-700">Allow earnings trades</span>
            <input
              type="checkbox"
              checked={allowEarnings}
              onChange={(e) => setAllowEarnings(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <div className="mt-2 text-xs text-zinc-600">If off, anything within ±10 days is a hard PASS.</div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-500">{sortedTickers.length} tickers</div>
          <button
            onClick={refresh}
            disabled={loading || sortedTickers.length === 0}
            className="rounded-full bg-emerald-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-200/50 transition-colors hover:bg-emerald-800 disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="spinner" style={{ width: "0.75rem", height: "0.75rem", borderWidth: "1.5px" }} />
                Refreshing
              </span>
            ) : "Refresh"}
          </button>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {data?.notFound?.length ? (
          <div className="mt-3 text-xs text-amber-800">
            Not found in demo universe: {data.notFound.join(", ")}
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/80 shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-white/70 px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Decisions</div>
            <div className="mt-1 text-xs text-zinc-600">Refresh to evaluate tickers server-side.</div>
          </div>
          <div className="text-xs text-zinc-500">{data ? "Updated" : "—"}</div>
        </div>

        {/* Empty state */}
        {sortedTickers.length === 0 && (
          <div className="flex items-center justify-center px-6 py-16">
            <div className="max-w-xs rounded-2xl border border-zinc-100 bg-zinc-50 px-6 py-8 text-center">
              <div className="text-sm font-semibold text-zinc-700">No tickers yet</div>
              <div className="mt-1 text-xs text-zinc-500">
                Add one above to evaluate.
              </div>
            </div>
          </div>
        )}

        {sortedTickers.length > 0 && (
          <>
            {/* Mobile card layout */}
            <div className="grid gap-3 p-4 lg:hidden">
              {sortedTickers.map((t) => {
                const r = resultsByTicker.get(t);
                return (
                  <div
                    key={t}
                    className={clsx(
                      "rounded-2xl border p-4 transition-colors",
                      cardBg(r?.decision),
                    )}
                  >
                    {/* Top row: ticker + decision + remove */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base font-bold text-zinc-900">{t}</span>
                        {r ? (
                          <Badge tone={decisionTone(r.decision)}>{r.decision}</Badge>
                        ) : (
                          <Badge tone="neutral">—</Badge>
                        )}
                      </div>
                      <button
                        onClick={() => removeTicker(t)}
                        aria-label={`Remove ${t}`}
                        className="shrink-0 rounded-md border px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300 transition-colors"
                      >
                        ×
                      </button>
                    </div>

                    {/* Reason */}
                    <div className="mt-2 text-xs text-zinc-600">
                      {r?.reason ?? "Not evaluated yet."}
                    </div>

                    {/* Key metrics */}
                    {r && (
                      <div className="mt-2 text-xs tabular-nums text-zinc-600">
                        spr {r.metrics.spreadPct.toFixed(3)}% · ADV$ {(r.metrics.advUsd / 1_000_000).toFixed(1)}M · ATR% {r.metrics.atrPct.toFixed(2)}
                      </div>
                    )}

                    {/* Details link */}
                    <div className="mt-3">
                      <Link
                        href={`/symbol/${encodeURIComponent(t)}?allowEarnings=${allowEarnings ? "1" : "0"}`}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table layout */}
            <div className="hidden overflow-auto lg:block">
              <table className="w-full min-w-[760px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="border-b px-4 py-2">Ticker</th>
                    <th className="border-b px-4 py-2">Decision</th>
                    <th className="border-b px-4 py-2">Reason</th>
                    <th className="border-b px-4 py-2">Key metrics</th>
                    <th className="border-b px-4 py-2">Link</th>
                    <th className="border-b px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTickers.map((t) => {
                    const r = resultsByTicker.get(t);
                    return (
                      <tr key={t} className={clsx("text-sm transition-colors", rowBg(r?.decision))}>
                        <td className="border-b px-4 py-3">
                          <span className="font-semibold text-zinc-900">{t}</span>
                        </td>
                        <td className="border-b px-4 py-3">
                          {r ? (
                            <Badge tone={decisionTone(r.decision)}>{r.decision}</Badge>
                          ) : (
                            <Badge tone="neutral">—</Badge>
                          )}
                        </td>
                        <td className="border-b px-4 py-3">
                          <div className="truncate text-xs text-zinc-700">{r?.reason ?? "Not evaluated yet."}</div>
                        </td>
                        <td className="border-b px-4 py-3">
                          {r ? (
                            <div className="text-xs tabular-nums text-zinc-600">
                              spr {r.metrics.spreadPct.toFixed(3)}% · ADV$ {(r.metrics.advUsd / 1_000_000).toFixed(1)}M · ATR% {r.metrics.atrPct.toFixed(2)}
                            </div>
                          ) : (
                            <div className="text-xs text-zinc-500">—</div>
                          )}
                        </td>
                        <td className="border-b px-4 py-3">
                          <Link
                            href={`/symbol/${encodeURIComponent(t)}?allowEarnings=${allowEarnings ? "1" : "0"}`}
                            className="text-xs font-medium text-blue-700 hover:underline"
                          >
                            Details
                          </Link>
                        </td>
                        <td className="border-b px-4 py-3 text-right">
                          <button
                            onClick={() => removeTicker(t)}
                            className="rounded-md border px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300 transition-colors"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
