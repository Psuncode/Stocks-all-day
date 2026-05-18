"use client";

import { useEffect, useMemo, useState } from "react";
import { ThesisCard } from "@/app/watchlist/_thesis-card";
import type { EnrichedEntry } from "@/app/watchlist/_thesis-card";
import type { LoadError } from "@/lib/thesis/load";

const LEGACY_STORAGE_KEY = "swing.watchlist.v1";

type Props = {
  data: EnrichedEntry[];
  errors: LoadError[];
  riskPct: number;
};

type LegacyShape = { tickers?: unknown };

function extractLegacyTickers(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as LegacyShape;
    const arr = parsed?.tickers;
    if (!Array.isArray(arr)) return [];
    const cleaned: string[] = [];
    for (const t of arr) {
      if (typeof t !== "string") continue;
      const norm = t.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
      if (norm) cleaned.push(norm);
    }
    return Array.from(new Set(cleaned));
  } catch {
    return [];
  }
}

function buildYamlSnippet(tickers: string[]): string {
  if (tickers.length === 0) return "";
  return tickers
    .map(
      (t) =>
        `  - ticker: ${t}\n    status: research_pending\n    notes: "migrated from localStorage"`,
    )
    .join("\n\n");
}

function MigrationBanner({
  tickers,
  onDismiss,
}: {
  tickers: string[];
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(() => buildYamlSnippet(tickers), [tickers]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Legacy watchlist found in browser</div>
          <div className="mt-1 text-xs">
            The watchlist now lives in <code>data/watchlist.yaml</code>. Copy
            the snippet below, paste it under <code>tickers:</code> in the YAML
            file (in your Obsidian vault → push to git), then dismiss this
            banner. {tickers.length} legacy ticker
            {tickers.length === 1 ? "" : "s"} detected:{" "}
            <span className="font-mono">{tickers.join(", ")}</span>.
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-3 flex items-start gap-2">
        <pre className="flex-1 overflow-auto rounded-lg border border-amber-200 bg-white p-3 text-xs leading-relaxed text-zinc-800">
          {snippet}
        </pre>
        <button
          onClick={copy}
          className="shrink-0 rounded-full bg-amber-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white hover:bg-amber-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function ErrorsBanner({ errors }: { errors: LoadError[] }) {
  const show = errors.slice(0, 5);
  return (
    <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="font-semibold">
        {errors.length} schema error{errors.length === 1 ? "" : "s"} in
        watchlist.yaml
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {show.map((e, i) => (
          <li key={i} className="tabular-nums">
            <span className="font-mono">{e.path.join(".") || "(root)"}</span>:{" "}
            {e.message}
          </li>
        ))}
        {errors.length > show.length && (
          <li className="text-red-700">
            ...and {errors.length - show.length} more
          </li>
        )}
      </ul>
    </div>
  );
}

function Section({
  title,
  data,
  defaultOpen,
}: {
  title: string;
  data: EnrichedEntry[];
  defaultOpen: boolean;
}) {
  if (data.length === 0) return null;
  return (
    <details
      open={defaultOpen}
      className="mb-6 rounded-[28px] border border-white/70 bg-white/80 shadow-sm"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          {title}
        </div>
        <div className="text-xs text-zinc-500">
          {data.length} ticker{data.length === 1 ? "" : "s"}
        </div>
      </summary>
      <div className="grid gap-3 p-4 lg:hidden">
        {data.map((d) => (
          <ThesisCard key={d.entry.ticker} data={d} variant="card" />
        ))}
      </div>
      <div className="hidden gap-3 p-4 lg:grid lg:grid-cols-1">
        {data.map((d) => (
          <ThesisCard key={d.entry.ticker} data={d} variant="row" />
        ))}
      </div>
    </details>
  );
}

export default function WatchlistView({ data, errors }: Props) {
  const [legacyTickers, setLegacyTickers] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const tickers = extractLegacyTickers(raw);
      if (tickers.length === 0) {
        // legacy key exists but is empty/garbage — just clear it
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return;
      }
      setLegacyTickers(tickers);
    } catch {
      // ignore
    }
  }, []);

  function dismissMigration() {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
    setLegacyTickers(null);
  }

  const active = data.filter((d) => d.entry.status === "active");
  const pending = data.filter((d) => d.entry.status === "research_pending");
  const shelved = data.filter(
    (d) =>
      d.entry.status === "shelved" ||
      d.entry.status === "dropped" ||
      d.entry.status === "exited",
  );

  const totalFires = active.reduce((n, d) => n + d.fires.length, 0);

  return (
    <div>
      {legacyTickers && legacyTickers.length > 0 && (
        <MigrationBanner
          tickers={legacyTickers}
          onDismiss={dismissMigration}
        />
      )}
      {errors.length > 0 && <ErrorsBanner errors={errors} />}

      {totalFires > 0 && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          🔥 {totalFires} invalidation{totalFires === 1 ? "" : "s"} fired across
          active tickers
        </div>
      )}

      {data.length === 0 && errors.length === 0 && (
        <div className="rounded-[28px] border border-zinc-100 bg-zinc-50 px-6 py-12 text-center">
          <div className="text-sm font-semibold text-zinc-700">
            No tickers yet
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Add entries under <code>tickers:</code> in{" "}
            <code>data/watchlist.yaml</code>.
          </div>
        </div>
      )}

      <Section title="Active" data={active} defaultOpen={true} />
      <Section title="Research pending" data={pending} defaultOpen={false} />
      <Section
        title="Shelved or dropped"
        data={shelved}
        defaultOpen={false}
      />
    </div>
  );
}
