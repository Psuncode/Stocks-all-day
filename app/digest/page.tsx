/**
 * Daily digest archive (Feature E) — requirements.md §10.6.
 *
 * Server component. Reads the last N digest snapshots from KV and computes
 * 1/3/7/30-day forward returns at read time using current candles via the
 * cached provider.
 */

import Link from "next/link";
import {
  loadRecentSnapshots,
  computeForwardReturns,
  HORIZONS,
  type ArchivedSnapshot,
  type ArchivedPick,
} from "@/lib/digest/archive";
import { getCachedSymbol } from "@/lib/data/cached-provider";
import { kvAvailable } from "@/lib/data/kv";
import { Badge } from "@/components/Badge";
import { isHealthcareSector, isUtahTicker } from "@/lib/preferences";

export const dynamic = "force-dynamic";

const DAYS_TO_SHOW = 14;

const pctFmt = (n: number | null) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function returnTone(n: number | null): string {
  if (n == null) return "text-zinc-400";
  if (n > 0.5) return "text-emerald-700";
  if (n < -0.5) return "text-red-700";
  return "text-zinc-600";
}

function decisionTone(d: string) {
  if (d === "TRADE") return "trade" as const;
  if (d === "WATCH") return "watch" as const;
  return "block" as const;
}

type EnrichedPick = ArchivedPick & {
  returns: Array<{ horizon: number; pct: number | null }>;
};

type EnrichedSnapshot = {
  date: string;
  generatedAt: string;
  picks: EnrichedPick[];
  // aggregate stats per horizon
  stats: Array<{ horizon: number; avg: number | null; hitRate: number | null }>;
};

async function enrichSnapshot(
  snap: ArchivedSnapshot,
): Promise<EnrichedSnapshot> {
  const enriched: EnrichedPick[] = await Promise.all(
    snap.picks.map(async (pick) => {
      const sym = await getCachedSymbol(pick.ticker).catch(() => null);
      const candles = (sym?.candles ?? []).map((c) => ({ t: c.t, c: c.c }));
      const returns = computeForwardReturns(snap.date, pick.pickClose, candles);
      return { ...pick, returns };
    }),
  );

  const stats = HORIZONS.map((h) => {
    const vals = enriched
      .map((p) => p.returns.find((r) => r.horizon === h)?.pct)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return { horizon: h, avg: null, hitRate: null };
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const hit = vals.filter((v) => v > 0).length / vals.length;
    return { horizon: h, avg, hitRate: hit };
  });

  return { date: snap.date, generatedAt: snap.generatedAt, picks: enriched, stats };
}

export default async function DigestArchivePage() {
  const kvOn = kvAvailable();
  if (!kvOn) {
    return (
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
        <h1 className="font-[family:var(--font-display)] text-2xl text-zinc-900">
          Digest archive
        </h1>
        <div className="mt-6 rounded-[28px] border border-amber-200 bg-amber-50/70 p-6 text-sm text-amber-900">
          <div className="font-semibold">Archive backend not configured.</div>
          <p className="mt-2">
            Set <code>UPSTASH_REDIS_REST_URL</code> and{" "}
            <code>UPSTASH_REDIS_REST_TOKEN</code> in your Vercel project to enable
            persistence. See <code>KV-SETUP.md</code> for a 5-minute setup walkthrough.
          </p>
        </div>
      </main>
    );
  }

  const snapshots = await loadRecentSnapshots(DAYS_TO_SHOW);

  if (snapshots.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
        <h1 className="font-[family:var(--font-display)] text-2xl text-zinc-900">
          Digest archive
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          No archived digests yet. The next daily cron (Mon-Fri 16:05 ET / 21:05 UTC)
          will persist a snapshot. You can also trigger a run now from{" "}
          <Link href="/scanner" className="text-emerald-800 underline">
            Scanner
          </Link>{" "}
          or manually via{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
            POST /api/check-invalidations
          </code>
          .
        </p>
      </main>
    );
  }

  const enriched = await Promise.all(snapshots.map(enrichSnapshot));

  // Overall aggregate across all days
  const overall = HORIZONS.map((h) => {
    const vals = enriched
      .flatMap((s) => s.picks)
      .map((p) => p.returns.find((r) => r.horizon === h)?.pct)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return { horizon: h, avg: null, hitRate: null, n: 0 };
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const hit = vals.filter((v) => v > 0).length / vals.length;
    return { horizon: h, avg, hitRate: hit, n: vals.length };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-[family:var(--font-display)] text-2xl text-zinc-900">
            Digest archive
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Last {snapshots.length} day{snapshots.length === 1 ? "" : "s"} ·
            forward returns updated live
          </p>
        </div>
        <div className="text-xs text-zinc-500 tabular-nums">
          {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} ·{" "}
          {enriched.reduce((s, x) => s + x.picks.length, 0)} picks
        </div>
      </div>

      {/* Overall aggregate */}
      <section className="mt-6 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
        <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          Engine performance (all picks, all days)
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overall.map((s) => (
            <div
              key={s.horizon}
              className="rounded-2xl border border-zinc-200 bg-white/60 p-3"
            >
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                {s.horizon}-day forward
              </div>
              <div
                className={`mt-1 text-base font-semibold tabular-nums ${returnTone(s.avg)}`}
              >
                avg {pctFmt(s.avg)}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                hit {s.hitRate == null ? "—" : `${Math.round(s.hitRate * 100)}%`} ·{" "}
                n={s.n}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 space-y-4">
        {enriched.map((snap) => (
          <DigestDay key={snap.date} snap={snap} />
        ))}
      </div>
    </main>
  );
}

function DigestDay({ snap }: { snap: EnrichedSnapshot }) {
  return (
    <details
      className="group rounded-[28px] border border-white/70 bg-white/80 shadow-sm"
      open
    >
      <summary className="cursor-pointer list-none px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <span className="font-[family:var(--font-display)] text-lg text-zinc-900">
              {snap.date}
            </span>
            <span className="text-xs text-zinc-500 tabular-nums">
              {snap.picks.length} pick{snap.picks.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 tabular-nums">
            {snap.stats.map((s) => (
              <span
                key={s.horizon}
                className={`rounded-full bg-zinc-50 px-2 py-1 ${returnTone(s.avg)}`}
              >
                {s.horizon}d {pctFmt(s.avg)}
              </span>
            ))}
          </div>
        </div>
      </summary>

      <div className="border-t border-zinc-100">
        {/* Mobile: cards. Desktop: table. */}
        <div className="grid gap-3 p-4 lg:hidden">
          {snap.picks.map((pick) => (
            <PickCardMobile key={pick.ticker} pick={pick} />
          ))}
        </div>
        <div className="hidden overflow-auto lg:block">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="bg-zinc-50/60 text-left text-xs text-zinc-500">
              <tr>
                <th className="border-b px-4 py-2">Ticker</th>
                <th className="border-b px-4 py-2">Decision</th>
                <th className="border-b px-4 py-2">Setup</th>
                <th className="border-b px-4 py-2 text-right tabular-nums">Pick</th>
                {HORIZONS.map((h) => (
                  <th
                    key={h}
                    className="border-b px-4 py-2 text-right tabular-nums"
                  >
                    {h}d
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snap.picks.map((pick) => (
                <PickRowDesktop key={pick.ticker} pick={pick} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function PickTags({ pick }: { pick: ArchivedPick }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
      {pick.sustainedHighVol ? <span title="3W momentum">🌀</span> : null}
      {isUtahTicker(pick.ticker) ? <span title="Utah">🏔️</span> : null}
      {isHealthcareSector(pick.sector) ? <span title="Healthcare">❤️</span> : null}
    </span>
  );
}

function PickRowDesktop({ pick }: { pick: EnrichedPick }) {
  return (
    <tr className="text-sm transition-colors hover:bg-zinc-50/40">
      <td className="border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Link
            href={`/symbol/${encodeURIComponent(pick.ticker)}`}
            className="font-semibold text-zinc-900 hover:underline"
          >
            {pick.ticker}
          </Link>
          <PickTags pick={pick} />
        </div>
        <div className="truncate text-[11px] text-zinc-500">{pick.name}</div>
      </td>
      <td className="border-b px-4 py-2">
        <Badge tone={decisionTone(pick.decision)}>{pick.decision}</Badge>
      </td>
      <td className="border-b px-4 py-2 text-xs text-zinc-600">
        {pick.setup === "NONE" ? "—" : pick.setup.toLowerCase().replace("_", " ")}
      </td>
      <td className="border-b px-4 py-2 text-right tabular-nums text-zinc-800">
        ${pick.pickClose.toFixed(2)}
      </td>
      {pick.returns.map((r) => (
        <td
          key={r.horizon}
          className={`border-b px-4 py-2 text-right font-semibold tabular-nums ${returnTone(r.pct)}`}
        >
          {pctFmt(r.pct)}
        </td>
      ))}
    </tr>
  );
}

function PickCardMobile({ pick }: { pick: EnrichedPick }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/symbol/${encodeURIComponent(pick.ticker)}`}
              className="font-semibold text-zinc-900"
            >
              {pick.ticker}
            </Link>
            <PickTags pick={pick} />
          </div>
          <div className="truncate text-[11px] text-zinc-500">{pick.name}</div>
        </div>
        <Badge tone={decisionTone(pick.decision)}>{pick.decision}</Badge>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-zinc-600 tabular-nums">
        <span>
          Pick ${pick.pickClose.toFixed(2)} ·{" "}
          {pick.setup === "NONE" ? "—" : pick.setup.toLowerCase().replace("_", " ")}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {pick.returns.map((r) => (
          <div
            key={r.horizon}
            className="rounded-lg border border-zinc-100 bg-zinc-50/40 px-2 py-1 text-center"
          >
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              {r.horizon}d
            </div>
            <div
              className={`mt-0.5 text-xs font-semibold tabular-nums ${returnTone(r.pct)}`}
            >
              {pctFmt(r.pct)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
