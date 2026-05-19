/**
 * MacroStrip — desktop-only regime context row.
 *
 * Renders nothing when the snapshot is null (FRED_API_KEY unset or fetch
 * failed), so the layout simply degrades to the existing status strip.
 *
 * Three cells, each: small uppercase label · tabular-nums value · 5-day
 * change with directional glyph + tone. Fed funds intentionally has no
 * 5-day delta because it moves on FOMC cadence (rarely day-to-day).
 */

import type { MacroSnapshot } from "@/lib/data/fred";

type Tone = "up" | "down" | "flat";

function toneFor(delta: number | null): Tone {
  if (delta === null || Math.abs(delta) < 0.005) return "flat";
  return delta > 0 ? "up" : "down";
}

function toneClass(tone: Tone, invert = false): string {
  if (tone === "flat") return "text-zinc-500";
  const isUp = tone === "up";
  const positive = invert ? !isUp : isUp;
  return positive ? "text-emerald-600" : "text-rose-600";
}

function glyphFor(tone: Tone): string {
  if (tone === "up") return "↑";
  if (tone === "down") return "↓";
  return "·";
}

function formatDelta(delta: number | null, digits = 2): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "";
  return `${sign}${delta.toFixed(digits)}`;
}

function Cell({
  label,
  value,
  delta,
  /** If true, an UP move is the "bad" outcome (e.g. VIX). */
  upIsBad = false,
  digits = 2,
  suffix = "",
}: {
  label: string;
  value: string;
  delta?: number | null;
  upIsBad?: boolean;
  digits?: number;
  suffix?: string;
}) {
  const showDelta = delta !== undefined;
  const tone = showDelta ? toneFor(delta ?? null) : "flat";
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <span className="font-[family:var(--font-mono)] text-sm font-medium tabular-nums text-zinc-900">
        {value}
        {suffix}
      </span>
      {showDelta && (
        <span
          className={`font-[family:var(--font-mono)] text-xs tabular-nums ${toneClass(
            tone,
            upIsBad,
          )}`}
        >
          {glyphFor(tone)} {formatDelta(delta ?? null, digits)}
          <span className="ml-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
            5d
          </span>
        </span>
      )}
    </div>
  );
}

export function MacroStrip({ snapshot }: { snapshot: MacroSnapshot }) {
  if (!snapshot) return null;

  return (
    <div className="hidden md:block">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mt-2 rounded-[24px] border border-white/70 bg-white/55 px-6 py-2.5 shadow-[0_18px_60px_-50px_rgba(15,23,42,0.5)]">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-1.5">
            <Cell
              label="VIX"
              value={snapshot.vix.value.toFixed(2)}
              delta={snapshot.vix.change5d}
              upIsBad
            />
            <Cell
              label="10Y"
              value={snapshot.yield10y.value.toFixed(2)}
              suffix="%"
              delta={snapshot.yield10y.change5d}
              upIsBad
            />
            <Cell
              label="Fed Funds"
              value={snapshot.fedFunds.value.toFixed(2)}
              suffix="%"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
