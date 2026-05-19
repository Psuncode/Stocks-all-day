"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Badge } from "@/components/Badge";
import { Drawer } from "@/components/Drawer";
import { GateBreakdown } from "@/components/GateBreakdown";
import type { Decision, DecisionResult, SetupTag } from "@/lib/types";
import { isHealthcareSector, isUtahTicker } from "@/lib/preferences";

type ScanResponse = {
  config: {
    includeBlocked: boolean;
    allowEarningsTrades: boolean;
    decisionFilter: Decision | "ALL";
    whyBlockedOnly: boolean;
    maxRows: number;
  };
  count: number;
  results: DecisionResult[];
  generatedAt: string;
};

function decisionTone(d: Decision) {
  if (d === "TRADE") return "trade" as const;
  if (d === "WATCH") return "watch" as const;
  return "block" as const;
}

function rowBg(d: Decision) {
  if (d === "TRADE") return "bg-green-50/40 hover:bg-green-50";
  if (d === "WATCH") return "bg-amber-50/30 hover:bg-amber-50/60";
  return "hover:bg-zinc-50";
}

function cardBg(d: Decision) {
  if (d === "TRADE") return "bg-green-50/40 border-green-100";
  if (d === "WATCH") return "bg-amber-50/30 border-amber-100";
  return "bg-white border-zinc-100";
}

function toCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  const cols = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r))),
  );
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const header = cols.map(escape).join(",");
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

const SETUP_LABELS: Record<SetupTag | "ALL", string> = {
  ALL: "All",
  PULLBACK: "Pullback",
  BASE_BREAKOUT: "Breakout",
  SQUEEZE: "Squeeze",
  OVERSOLD_BOUNCE: "Bounce",
  NONE: "No setup",
};

const SETUP_CHIPS: Array<SetupTag | "ALL"> = [
  "ALL",
  "PULLBACK",
  "BASE_BREAKOUT",
  "SQUEEZE",
  "OVERSOLD_BOUNCE",
  "NONE",
];

type ToggleColor = "orange" | "emerald" | "rose";

const COLOR_STYLES: Record<
  ToggleColor,
  { active: string; idle: string; countActive: string; countIdle: string }
> = {
  orange: {
    active: "bg-orange-600 text-white",
    idle: "border border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100",
    countActive: "text-orange-200",
    countIdle: "text-orange-500",
  },
  emerald: {
    active: "bg-emerald-700 text-white",
    idle: "border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    countActive: "text-emerald-200",
    countIdle: "text-emerald-600",
  },
  rose: {
    active: "bg-rose-600 text-white",
    idle: "border border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100",
    countActive: "text-rose-200",
    countIdle: "text-rose-500",
  },
};

function ToggleChip({
  active,
  count,
  onClick,
  label,
  colorClass,
  title,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  label: string;
  colorClass: ToggleColor;
  title?: string;
}) {
  const empty = count === 0 && !active;
  const style = COLOR_STYLES[colorClass];
  return (
    <button
      onClick={onClick}
      disabled={empty}
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full py-2 px-3 text-xs font-semibold transition-colors",
        active
          ? style.active
          : empty
            ? "border border-zinc-200 bg-white text-zinc-400 cursor-not-allowed"
            : style.idle,
      )}
    >
      <span>{label}</span>
      <span
        className={clsx(
          "tabular-nums",
          active ? style.countActive : empty ? "text-zinc-300" : style.countIdle,
        )}
      >
        {count}
      </span>
    </button>
  );
}

export default function ScannerClient() {
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [allowEarnings, setAllowEarnings] = useState(false);
  const [decision, setDecision] = useState<Decision | "ALL">("ALL");
  const [whyBlockedOnly, setWhyBlockedOnly] = useState(false);
  const [maxRows, setMaxRows] = useState(0);
  const [search, setSearch] = useState("");
  const [setupFilter, setSetupFilter] = useState<SetupTag | "ALL">("ALL");
  const [momentumOnly, setMomentumOnly] = useState(false);
  const [utahOnly, setUtahOnly] = useState(false);
  const [healthcareOnly, setHealthcareOnly] = useState(false);

  // Feature F — quick-watch state. Loaded from /api/watch on mount;
  // toggled by per-row buttons.
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchInflight, setWatchInflight] = useState<Set<string>>(new Set());
  const [watchEnabled, setWatchEnabled] = useState(true);

  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTicker, setDrawerTicker] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<DecisionResult | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (includeBlocked) p.set("includeBlocked", "1");
    if (allowEarnings) p.set("allowEarnings", "1");
    if (whyBlockedOnly) p.set("whyBlockedOnly", "1");
    if (decision !== "ALL") p.set("decision", decision);
    p.set("maxRows", String(maxRows));
    return p.toString();
  }, [includeBlocked, allowEarnings, whyBlockedOnly, decision, maxRows]);

  const filteredResults = useMemo(() => {
    const results = data?.results ?? [];
    const q = search.trim().toLowerCase();
    const afterSearch = q
      ? results.filter((r) =>
          r.ticker.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q),
        )
      : results;
    const afterSetup =
      setupFilter === "ALL"
        ? afterSearch
        : afterSearch.filter((r) => r.gateSummary.setup === setupFilter);
    return afterSetup.filter((r) => {
      if (momentumOnly && !r.metrics.sustainedHighVol) return false;
      if (utahOnly && !isUtahTicker(r.ticker)) return false;
      if (healthcareOnly && !isHealthcareSector(r.sector)) return false;
      return true;
    });
  }, [data, search, setupFilter, momentumOnly, utahOnly, healthcareOnly]);

  const summary = useMemo(() => {
    const results = filteredResults;
    let trade = 0;
    let watch = 0;
    let pass = 0;
    for (const r of results) {
      if (r.decision === "TRADE") trade++;
      else if (r.decision === "WATCH") watch++;
      else pass++;
    }
    return { trade, watch, pass, total: results.length };
  }, [filteredResults]);

  // Counts for the orthogonal toggles (computed pre-toggle so each chip
  // always shows what's available regardless of which other toggles are on).
  const toggleCounts = useMemo(() => {
    const results = data?.results ?? [];
    const q = search.trim().toLowerCase();
    const afterSearch = q
      ? results.filter(
          (r) =>
            r.ticker.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            r.sector.toLowerCase().includes(q),
        )
      : results;
    return {
      momentum: afterSearch.filter((r) => r.metrics.sustainedHighVol).length,
      utah: afterSearch.filter((r) => isUtahTicker(r.ticker)).length,
      healthcare: afterSearch.filter((r) => isHealthcareSector(r.sector)).length,
    };
  }, [data, search]);
  const momentumCount = toggleCounts.momentum;

  // Setup counts computed BEFORE the setupFilter so chips show what's
  // available regardless of which chip is currently active.
  const setupCounts = useMemo(() => {
    const results = data?.results ?? [];
    const q = search.trim().toLowerCase();
    const afterSearch = q
      ? results.filter(
          (r) =>
            r.ticker.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            r.sector.toLowerCase().includes(q),
        )
      : results;
    const counts: Record<SetupTag | "ALL", number> = {
      ALL: afterSearch.length,
      PULLBACK: 0,
      BASE_BREAKOUT: 0,
      SQUEEZE: 0,
      OVERSOLD_BOUNCE: 0,
      NONE: 0,
    };
    for (const r of afterSearch) {
      counts[r.gateSummary.setup] = (counts[r.gateSummary.setup] ?? 0) + 1;
    }
    return counts;
  }, [data, search]);

  async function copyTickers() {
    const list = filteredResults.map((r) => r.ticker).join("\n");
    try {
      await navigator.clipboard.writeText(list);
    } catch {
      // ignore
    }
  }

  function exportCsv() {
    const rows = filteredResults.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      sector: r.sector,
      decision: r.decision,
      reason: r.reason,
      trend: r.gateSummary.trend,
      vol: r.gateSummary.vol,
      liquidity: r.gateSummary.liquidity,
      event: r.gateSummary.event,
      setup: r.gateSummary.setup,
      price: r.metrics.price,
      spreadPct: r.metrics.spreadPct,
      advUsd: r.metrics.advUsd,
      atrPct: r.metrics.atrPct,
      rs60: r.metrics.rs60,
    }));
    const csv = toCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`scanner_${stamp}.csv`, csv);
  }

  // Initial load of the quick-watch set. Failure-soft — if KV isn't
  // configured the endpoint returns kv:false and the button just shows
  // as inactive forever (we set watchEnabled=false to hide UI).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/watch")
      .then((r) => r.json())
      .then((json: { tickers?: string[]; kv?: boolean }) => {
        if (cancelled) return;
        if (json.kv === false) {
          setWatchEnabled(false);
          return;
        }
        setWatched(new Set((json.tickers ?? []).map((t) => t.toUpperCase())));
      })
      .catch(() => {
        if (!cancelled) setWatchEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleWatch(r: DecisionResult) {
    if (!watchEnabled) return;
    const t = r.ticker.toUpperCase();
    if (watchInflight.has(t)) return;
    setWatchInflight((prev) => {
      const next = new Set(prev);
      next.add(t);
      return next;
    });
    // Optimistic flip
    const wasWatched = watched.has(t);
    setWatched((prev) => {
      const next = new Set(prev);
      if (wasWatched) next.delete(t);
      else next.add(t);
      return next;
    });
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: t,
          name: r.name,
          sector: r.sector,
          decision: r.decision,
          setup: r.gateSummary.setup,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Revert on failure
      setWatched((prev) => {
        const next = new Set(prev);
        if (wasWatched) next.add(t);
        else next.delete(t);
        return next;
      });
    } finally {
      setWatchInflight((prev) => {
        const next = new Set(prev);
        next.delete(t);
        return next;
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/scan?${query}`);
        if (!res.ok) throw new Error(`Scan failed (${res.status})`);
        const json = (await res.json()) as ScanResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function openWhyBlocked(ticker: string) {
    setDrawerOpen(true);
    setDrawerTicker(ticker);
    setDrawerDetail(null);
    setDrawerLoading(true);
    try {
      const p = new URLSearchParams();
      if (allowEarnings) p.set("allowEarnings", "1");
      const res = await fetch(`/api/symbol/${encodeURIComponent(ticker)}?${p.toString()}`);
      if (!res.ok) throw new Error(`Detail failed (${res.status})`);
      const json = (await res.json()) as { result: DecisionResult };
      setDrawerDetail(json.result);
    } catch (e) {
      setDrawerDetail(null);
    } finally {
      setDrawerLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      {/* On mobile, results come first so the user lands on data (not on a
          280px filter panel pushing the results below the fold).
          GSD UI review pass 2 C3. */}
      <section className="order-2 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm lg:order-1">
        <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Filters</div>
        <div className="mt-3 space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span className="text-zinc-700">Include blocked symbols</span>
            <input
              type="checkbox"
              checked={includeBlocked}
              onChange={(e) => setIncludeBlocked(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-zinc-700">Why blocked only</span>
            <input
              type="checkbox"
              checked={whyBlockedOnly}
              onChange={(e) => setWhyBlockedOnly(e.target.checked)}
              className="h-4 w-4"
            />
          </label>

          <div className="rounded-2xl border border-white/70 bg-white/70 p-3">
            <div className="text-xs font-semibold text-zinc-900">Earnings (default: off)</div>
            <label className="mt-2 flex items-center justify-between gap-3">
              <span className="text-zinc-700">Allow earnings trades</span>
              <input
                type="checkbox"
                checked={allowEarnings}
                onChange={(e) => setAllowEarnings(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
            <div className="mt-2 text-xs text-zinc-600">
              If off, anything within ±10 days is a hard PASS.
            </div>
          </div>

          <label className="block">
            <div className="text-xs font-semibold text-zinc-900">Decision</div>
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as any)}
              className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
            >
              <option value="ALL">All</option>
              <option value="TRADE">TRADE</option>
              <option value="WATCH">WATCH</option>
              <option value="PASS">PASS</option>
            </select>
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-zinc-900">Max rows</div>
            <select
              value={maxRows}
              onChange={(e) => setMaxRows(Number(e.target.value))}
              className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
            >
              <option value={0}>All</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
        </div>
      </section>

      <section className="order-1 rounded-[28px] border border-white/70 bg-white/80 shadow-sm lg:order-2">
        <div className="flex items-center justify-between gap-3 border-b border-white/70 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900">Scanner</div>
            <div className="mt-0.5 text-xs text-zinc-600">
              Most names should be <span className="font-medium">PASS</span>. That&apos;s the product.
            </div>
          </div>
          <div className="text-xs text-zinc-500">
            {loading ? "Scanning…" : data ? `${summary.total} shown` : "—"}
          </div>
        </div>

        {/* Summary bar + search + actions */}
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2">
            <Badge tone="trade">TRADE {summary.trade}</Badge>
            <Badge tone="watch">WATCH {summary.watch}</Badge>
            <Badge tone="block">PASS {summary.pass}</Badge>
            <span className="text-xs text-zinc-400">|</span>
            <span className="text-xs text-zinc-500">{summary.total} total</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker / name / sector"
              className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100 sm:w-[280px]"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={copyTickers}
                disabled={!data || filteredResults.length === 0}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 disabled:opacity-50"
              >
                Copy tickers
              </button>
              <button
                onClick={exportCsv}
                disabled={!data || filteredResults.length === 0}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 disabled:opacity-50"
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* Setup filter chips + 3W momentum toggle */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
          {SETUP_CHIPS.map((chip) => {
            const count = setupCounts[chip] ?? 0;
            const active = setupFilter === chip;
            const empty = count === 0 && chip !== "ALL";
            return (
              <button
                key={chip}
                onClick={() => setSetupFilter(chip)}
                disabled={empty}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full py-2 px-3 text-xs font-semibold transition-colors",
                  active
                    ? "bg-emerald-900 text-white"
                    : empty
                      ? "border border-zinc-200 bg-white text-zinc-400 cursor-not-allowed"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                )}
              >
                <span>{SETUP_LABELS[chip]}</span>
                <span
                  className={clsx(
                    "tabular-nums",
                    active
                      ? "text-emerald-200"
                      : empty
                        ? "text-zinc-300"
                        : "text-zinc-400",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
          <div className="ml-2 h-5 w-px bg-zinc-200" aria-hidden="true" />
          <ToggleChip
            active={momentumOnly}
            count={toggleCounts.momentum}
            onClick={() => setMomentumOnly((v) => !v)}
            label="🌀 3W momentum"
            colorClass="orange"
            title="High vol + price tracking 15-day SMA, not a one-day spike"
          />
          <ToggleChip
            active={utahOnly}
            count={toggleCounts.utah}
            onClick={() => setUtahOnly((v) => !v)}
            label="🏔️ Utah"
            colorClass="emerald"
            title="Companies headquartered in Utah"
          />
          <ToggleChip
            active={healthcareOnly}
            count={toggleCounts.healthcare}
            onClick={() => setHealthcareOnly((v) => !v)}
            label="❤️ Healthcare"
            colorClass="rose"
            title="Healthcare sector"
          />
        </div>

        {error && (
          <div className="mx-4 my-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!error && !data && loading && (
          <div className="flex items-center justify-center gap-3 px-4 py-16">
            <span className="spinner-lg" />
            <span className="text-sm text-zinc-500">Scanning universe...</span>
          </div>
        )}

        {data && (
          <>
            {/* Mobile card layout */}
            <div className="grid gap-3 p-4 lg:hidden">
              {filteredResults.map((r) => (
                <div
                  key={r.ticker}
                  className={clsx(
                    "rounded-2xl border p-4 transition-colors",
                    cardBg(r.decision),
                  )}
                >
                  {/* Top row: ticker + decision */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/symbol/${encodeURIComponent(r.ticker)}${allowEarnings ? "?allowEarnings=1" : ""}`}
                        className="text-base font-bold text-zinc-900 hover:underline"
                      >
                        {r.ticker}
                      </Link>
                      <div className="mt-0.5 truncate text-xs text-zinc-500">
                        {r.sector} &middot; {r.name}
                      </div>
                    </div>
                    <Badge tone={decisionTone(r.decision)}>{r.decision}</Badge>
                  </div>

                  {/* Key stats grid */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums text-zinc-600">
                    <div>
                      <span className="font-medium text-zinc-700">Price</span>{" "}
                      ${r.metrics.price.toFixed(2)}
                    </div>
                    <div>
                      <span className="font-medium text-zinc-700">Spread</span>{" "}
                      {r.metrics.spreadPct.toFixed(3)}%
                    </div>
                    <div>
                      <span className="font-medium text-zinc-700">ADV$</span>{" "}
                      {(r.metrics.advUsd / 1_000_000).toFixed(1)}M
                    </div>
                    <div>
                      <span className="font-medium text-zinc-700">ATR%</span>{" "}
                      {r.metrics.atrPct.toFixed(2)}
                    </div>
                  </div>

                  {/* Gate mini-badges */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={r.gateSummary.trend === "ALIGNED" ? "ok" : r.gateSummary.trend === "MIXED" ? "watch" : "block"}>
                      {r.gateSummary.trend}
                    </Badge>
                    <Badge tone={r.gateSummary.vol === "HIGH" ? "watch" : "soft"}>
                      {r.gateSummary.vol}
                    </Badge>
                    <Badge tone={r.gateSummary.liquidity === "CLEAN" ? "ok" : r.gateSummary.liquidity === "CARE" ? "watch" : "block"}>
                      {r.gateSummary.liquidity}
                    </Badge>
                    <Badge tone={r.gateSummary.event === "RISK" ? "watch" : r.gateSummary.event === "OK" ? "info" : "neutral"}>
                      {r.gateSummary.event}
                    </Badge>
                    <Badge tone={r.gateSummary.setup === "NONE" ? "neutral" : "info"}>
                      {r.gateSummary.setup}
                    </Badge>
                  </div>

                  {/* Reason */}
                  <div className="mt-2 text-xs text-zinc-600">{r.reason}</div>

                  {/* Trade plan */}
                  {r.plan && (
                    <div className="mt-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs tabular-nums text-green-900">
                      Entry {r.plan.entry} · Stop {r.plan.stop} · Target {r.plan.target} · R:R {r.plan.rr}
                    </div>
                  )}

                  {/* Action buttons — Watch + Explain */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {watchEnabled ? (
                      <WatchButton
                        watched={watched.has(r.ticker.toUpperCase())}
                        loading={watchInflight.has(r.ticker.toUpperCase())}
                        onClick={() => toggleWatch(r)}
                      />
                    ) : null}
                    <button
                      onClick={() => openWhyBlocked(r.ticker)}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800"
                    >
                      Explain
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table layout */}
            <div className="hidden overflow-auto lg:block">
              <table className="w-full min-w-[900px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="border-b px-4 py-2">Ticker</th>
                    <th className="border-b px-4 py-2">Trend</th>
                    <th className="border-b px-4 py-2">Vol</th>
                    <th className="border-b px-4 py-2">Liquidity</th>
                    <th className="border-b px-4 py-2">Event</th>
                    <th className="border-b px-4 py-2">Setup</th>
                    <th className="border-b px-4 py-2">Decision</th>
                    <th className="border-b px-4 py-2">Why blocked?</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => (
                    <tr key={r.ticker} className={clsx("text-sm transition-colors", rowBg(r.decision))}>
                      <td className="border-b px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/symbol/${encodeURIComponent(r.ticker)}${allowEarnings ? "?allowEarnings=1" : ""}`}
                            className="font-semibold text-zinc-900 hover:underline"
                          >
                            {r.ticker}
                          </Link>
                          <span className="truncate text-xs text-zinc-500">{r.sector}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-zinc-600">{r.name}</div>
                      </td>
                      <td className="border-b px-4 py-3">
                        <Badge tone={r.gateSummary.trend === "ALIGNED" ? "ok" : r.gateSummary.trend === "MIXED" ? "watch" : "block"}>
                          {r.gateSummary.trend}
                        </Badge>
                      </td>
                      <td className="border-b px-4 py-3">
                        <Badge tone={r.gateSummary.vol === "HIGH" ? "watch" : "soft"}>{r.gateSummary.vol}</Badge>
                        <div className="mt-1 text-xs tabular-nums text-zinc-600">ATR% {r.metrics.atrPct.toFixed(2)}</div>
                      </td>
                      <td className="border-b px-4 py-3">
                        <Badge tone={r.gateSummary.liquidity === "CLEAN" ? "ok" : r.gateSummary.liquidity === "CARE" ? "watch" : "block"}>
                          {r.gateSummary.liquidity}
                        </Badge>
                        <div className="mt-1 text-xs tabular-nums text-zinc-600">
                          spr {r.metrics.spreadPct.toFixed(3)}% · ADV$ {(r.metrics.advUsd / 1_000_000).toFixed(1)}M
                        </div>
                      </td>
                      <td className="border-b px-4 py-3">
                        <Badge tone={r.gateSummary.event === "RISK" ? "watch" : r.gateSummary.event === "OK" ? "info" : "neutral"}>
                          {r.gateSummary.event}
                        </Badge>
                      </td>
                      <td className="border-b px-4 py-3">
                        <Badge tone={r.gateSummary.setup === "NONE" ? "neutral" : "info"}>{r.gateSummary.setup}</Badge>
                      </td>
                      <td className="border-b px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Badge tone={decisionTone(r.decision)}>{r.decision}</Badge>
                          <span className="truncate text-xs text-zinc-600">{r.reason}</span>
                        </div>
                        {r.plan && (
                          <div className="mt-1 text-xs tabular-nums text-zinc-600">
                            Entry {r.plan.entry} · Stop {r.plan.stop} · Target {r.plan.target} · R:R {r.plan.rr}
                          </div>
                        )}
                      </td>
                      <td className="border-b px-4 py-3">
                        <div className="flex items-center gap-2">
                          {watchEnabled ? (
                            <WatchButton
                              watched={watched.has(r.ticker.toUpperCase())}
                              loading={watchInflight.has(r.ticker.toUpperCase())}
                              onClick={() => toggleWatch(r)}
                            />
                          ) : null}
                          <button
                            onClick={() => openWhyBlocked(r.ticker)}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800"
                          >
                            Explain
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title={drawerTicker ? `${drawerTicker} — Gate Breakdown` : "Gate Breakdown"}
        onClose={() => setDrawerOpen(false)}
      >
        {drawerLoading && (
          <div className="flex items-center gap-2 py-8">
            <span className="spinner" />
            <span className="text-sm text-zinc-500">Loading gate breakdown...</span>
          </div>
        )}
        {!drawerLoading && !drawerDetail && (
          <div className="text-sm text-zinc-600">Couldn&apos;t load details.</div>
        )}
        {drawerDetail && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">{drawerDetail.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-600">{drawerDetail.sector}</div>
                </div>
                <Badge tone={decisionTone(drawerDetail.decision)}>{drawerDetail.decision}</Badge>
              </div>
              <div className="mt-2 text-sm text-zinc-700">{drawerDetail.reason}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs tabular-nums text-zinc-600">
                <div>Price: {drawerDetail.metrics.price.toFixed(2)}</div>
                <div>Spread%: {drawerDetail.metrics.spreadPct.toFixed(3)}</div>
                <div>ADV$: {(drawerDetail.metrics.advUsd / 1_000_000).toFixed(1)}M</div>
                <div>RS(60): {drawerDetail.metrics.rs60.toFixed(2)}</div>
              </div>
              {drawerDetail.plan && (
                <div className="mt-3 rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-900">
                  <div className="text-xs font-semibold">Trade plan (example)</div>
                  <div className="mt-1 text-xs tabular-nums">
                    Entry {drawerDetail.plan.entry} · Stop {drawerDetail.plan.stop} · Target {drawerDetail.plan.target}
                  </div>
                  <div className="mt-1 text-xs tabular-nums">
                    R:R {drawerDetail.plan.rr} · Est hold {drawerDetail.plan.estHold}
                  </div>
                </div>
              )}
            </div>
            <GateBreakdown gates={drawerDetail.gates} />
            <div className="text-xs text-zinc-500">
              Rule-based gating to reduce bad trades. Not investment advice.
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function WatchButton({
  watched,
  loading,
  onClick,
}: {
  watched: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-pressed={watched}
      aria-label={watched ? "Remove from quick watch" : "Add to quick watch"}
      className={clsx(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors",
        watched
          ? "bg-emerald-700 text-white hover:bg-emerald-800"
          : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50",
        loading && "opacity-60",
      )}
    >
      <span aria-hidden="true">{watched ? "👁" : "👁‍🗨"}</span>
      <span>{watched ? "Watching" : "Watch"}</span>
    </button>
  );
}
