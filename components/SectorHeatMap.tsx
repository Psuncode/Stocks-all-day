/**
 * Sector heat map panel — server component.
 *
 * v3.0 T3 — gives the user a 2-second read on "which sectors are working
 * today". Built from the same universe data the scanner uses (no extra
 * network calls). Grouped by `meta.sector`, 5-day avg return per sector.
 *
 * Color saturation scales with magnitude, clamped to ±5%. Cards under 3
 * tickers are filtered out upstream — tiny sectors are noise.
 */

export type SectorPerformance = {
  sector: string;
  avgReturn5d: number; // fractional, e.g. 0.012 = +1.2%
  tickerCount: number;
};

export type SectorHeatMapProps = {
  sectorPerformance: SectorPerformance[];
};

// Map a fractional return clamped to ±0.05 onto a 0..1 intensity, then
// pick a Tailwind background+text shade. Five buckets per direction.
function shadeFor(ret: number): { bg: string; text: string; arrow: string } {
  const clamped = Math.max(-0.05, Math.min(0.05, ret));
  const mag = Math.abs(clamped) / 0.05; // 0..1
  if (clamped > 0) {
    const arrow = "↑";
    if (mag < 0.2) return { bg: "bg-emerald-50 border-emerald-100", text: "text-emerald-900", arrow };
    if (mag < 0.4) return { bg: "bg-emerald-100 border-emerald-200", text: "text-emerald-900", arrow };
    if (mag < 0.6) return { bg: "bg-emerald-200 border-emerald-300", text: "text-emerald-900", arrow };
    if (mag < 0.8) return { bg: "bg-emerald-300 border-emerald-400", text: "text-emerald-950", arrow };
    return { bg: "bg-emerald-400 border-emerald-500", text: "text-emerald-950", arrow };
  }
  if (clamped < 0) {
    const arrow = "↓";
    if (mag < 0.2) return { bg: "bg-rose-50 border-rose-100", text: "text-rose-900", arrow };
    if (mag < 0.4) return { bg: "bg-rose-100 border-rose-200", text: "text-rose-900", arrow };
    if (mag < 0.6) return { bg: "bg-rose-200 border-rose-300", text: "text-rose-900", arrow };
    if (mag < 0.8) return { bg: "bg-rose-300 border-rose-400", text: "text-rose-950", arrow };
    return { bg: "bg-rose-400 border-rose-500", text: "text-rose-950", arrow };
  }
  return { bg: "bg-zinc-50 border-zinc-100", text: "text-zinc-700", arrow: "·" };
}

export function SectorHeatMap({ sectorPerformance }: SectorHeatMapProps) {
  if (!sectorPerformance || sectorPerformance.length === 0) return null;
  // Sort by avgReturn5d desc so the winning sectors lead.
  const sorted = [...sectorPerformance].sort(
    (a, b) => b.avgReturn5d - a.avgReturn5d,
  );

  return (
    <section className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
            Sector heat map
          </div>
          <div className="mt-0.5 text-xs text-zinc-600">
            5-day average return per sector · {sorted.length} sectors shown
          </div>
        </div>
        <div className="text-[11px] tabular-nums text-zinc-500">
          color clamped to ±5%
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((s) => {
          const shade = shadeFor(s.avgReturn5d);
          const pct = (s.avgReturn5d * 100).toFixed(2);
          return (
            <div
              key={s.sector}
              className={`rounded-2xl border px-3 py-2 min-h-[3.25rem] flex flex-col justify-between ${shade.bg} ${shade.text}`}
              title={`${s.sector} · ${pct}% · ${s.tickerCount} tickers`}
            >
              <div className="text-xs font-semibold leading-tight break-words" title={s.sector}>{s.sector}</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <div className="text-sm font-bold tabular-nums">
                  <span aria-hidden="true">{shade.arrow}</span> {pct}%
                </div>
                <div className="text-[10px] tabular-nums opacity-70">
                  {s.tickerCount}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default SectorHeatMap;
