/**
 * Digest archive — persist daily snapshots + compute forward returns.
 *
 * Storage layout (Upstash Redis, see KV-SETUP.md):
 *   digest:<YYYY-MM-DD>  →  JSON snapshot { date, picks, generatedAt }
 *   digest:index         →  SET of dates  ("2026-05-19", "2026-05-18", ...)
 *
 * Forward returns are computed at READ time using current daily candles
 * (via the cached provider), not persisted. Means we always show fresh
 * returns and don't need to re-write old records.
 */

import { getKv } from "@/lib/data/kv";
import type { DigestPick } from "@/lib/digest/build";

const INDEX_KEY = "digest:index";
const KEEP_DAYS = 60; // trim older snapshots so we don't grow unbounded

export type ArchivedPick = {
  ticker: string;
  name: string;
  sector: string;
  decision: string;
  setup: string;
  rr: number | null;
  pickClose: number;            // closing price at the moment of the cron
  sustainedHighVol: boolean;
  reason: string;
};

export type ArchivedSnapshot = {
  date: string;                 // YYYY-MM-DD
  generatedAt: string;          // ISO
  picks: ArchivedPick[];
};

function snapshotKey(date: string): string {
  return `digest:${date}`;
}

export async function persistDigest(
  date: string,
  picks: DigestPick[],
): Promise<{ ok: boolean; reason?: string }> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };

  const archived: ArchivedSnapshot = {
    date,
    generatedAt: new Date().toISOString(),
    picks: picks.map((p) => ({
      ticker: p.result.ticker,
      name: p.result.name,
      sector: p.result.sector,
      decision: p.result.decision,
      setup: p.result.gateSummary.setup,
      rr: p.result.plan?.rr ?? null,
      pickClose: p.result.metrics.price,
      sustainedHighVol: p.result.metrics.sustainedHighVol,
      reason: p.result.reason,
    })),
  };

  try {
    // GSD review pass 3 H1: warn when overwriting a same-day snapshot
    // (e.g. manual cron earlier in the day getting clobbered by the
    // 21:05 UTC scheduled run). For a personal tool last-write-wins is
    // fine, but the log makes it visible.
    const prior = await kv.exists(snapshotKey(date));
    if (prior) {
      console.warn(
        `[digest-archive] overwriting existing snapshot for ${date}; ` +
          `forward returns will anchor to the new pickClose values.`,
      );
    }
    await kv.set(snapshotKey(date), archived);
    await kv.sadd(INDEX_KEY, date);
    // Trim: drop snapshots older than KEEP_DAYS.
    const all = (await kv.smembers(INDEX_KEY)) as string[];
    const sorted = all
      .filter((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s))
      .sort();
    if (sorted.length > KEEP_DAYS) {
      const stale = sorted.slice(0, sorted.length - KEEP_DAYS);
      await Promise.all(stale.map((d) => kv.del(snapshotKey(d))));
      await kv.srem(INDEX_KEY, ...stale);
    }
    return { ok: true };
  } catch (e) {
    console.error(`[digest-archive] persist failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

export async function loadRecentSnapshots(
  days: number,
): Promise<ArchivedSnapshot[]> {
  const kv = getKv();
  if (!kv) return [];

  try {
    const all = (await kv.smembers(INDEX_KEY)) as string[];
    const dates = all
      .filter((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s))
      .sort()
      .slice(-days)
      .reverse(); // newest first

    if (dates.length === 0) return [];

    const records = await Promise.all(
      dates.map((d) => kv.get<ArchivedSnapshot>(snapshotKey(d))),
    );
    return records.filter((r): r is ArchivedSnapshot => r !== null);
  } catch (e) {
    console.error(`[digest-archive] load failed: ${(e as Error).message}`);
    return [];
  }
}

// Calendar-day horizons measured against the pick date. Forward return at
// horizon H is computed by finding the FIRST trading day's close on or
// after (pick_date + H calendar days). If that day hasn't happened yet,
// the horizon return is null.
export const HORIZONS = [1, 3, 7, 30] as const;
export type Horizon = (typeof HORIZONS)[number];

export type ForwardReturn = {
  horizon: Horizon;
  pct: number | null;
};

export function computeForwardReturns(
  pickDate: string,
  pickClose: number,
  todayCandles: Array<{ t: string; c: number }>,
): ForwardReturn[] {
  if (todayCandles.length === 0) {
    return HORIZONS.map((h) => ({ horizon: h, pct: null }));
  }
  return HORIZONS.map((horizon) => {
    const target = addDays(pickDate, horizon);
    const closeAtOrAfter = findCloseOnOrAfter(todayCandles, target);
    if (closeAtOrAfter == null || pickClose <= 0) {
      return { horizon, pct: null };
    }
    return { horizon, pct: (closeAtOrAfter / pickClose - 1) * 100 };
  });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findCloseOnOrAfter(
  candles: Array<{ t: string; c: number }>,
  target: string,
): number | null {
  // Candles assumed sorted ascending by t.
  for (const c of candles) {
    if (c.t >= target) return c.c;
  }
  return null;
}
