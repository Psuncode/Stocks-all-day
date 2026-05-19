"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

/**
 * Symbol-page Watch toggle (v2.1 T3 stretch).
 *
 * Client component because we need a) the initial fetch to know if the
 * ticker is already in the quick-watch set, and b) optimistic state on
 * click. Mirrors the scanner-client WatchButton but stands alone since
 * symbol page is a server component otherwise.
 *
 * Hidden entirely when /api/watch reports kv=false so we don't tease
 * an unconfigured feature.
 */
export function SymbolWatchButton({
  ticker,
  name,
  sector,
  decision,
  setup,
}: {
  ticker: string;
  name: string;
  sector: string;
  decision: string;
  setup: string;
}) {
  const [watched, setWatched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/watch")
      .then((r) => r.json())
      .then((json: { tickers?: string[]; kv?: boolean }) => {
        if (cancelled) return;
        if (json.kv === false) {
          setEnabled(false);
          return;
        }
        const set = new Set((json.tickers ?? []).map((t) => t.toUpperCase()));
        setWatched(set.has(ticker.toUpperCase()));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (!enabled) return null;

  async function toggle() {
    if (loading) return;
    setLoading(true);
    const wasWatched = watched;
    setWatched(!wasWatched);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker, name, sector, decision, setup }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setWatched(wasWatched);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-pressed={watched}
      aria-label={watched ? "Remove from quick watch" : "Add to quick watch"}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-colors",
        watched
          ? "bg-emerald-700 text-white hover:bg-emerald-800"
          : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50",
        loading && "opacity-60",
      )}
    >
      <span aria-hidden="true">{watched ? "👁" : "👁‍🗨"}</span>
      <span>{watched ? "Watching" : "Watch"}</span>
    </button>
  );
}
