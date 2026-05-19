/**
 * Trade journal archive (v4.0 T1) — KV-backed CRUD + stats.
 *
 * Storage layout (Upstash Redis):
 *   journal:set   →  SET of trade IDs (sortable lexicographically by their
 *                    timestamp-prefixed shape so smembers + sort = chronological)
 *   journal:<id>  →  JSON-encoded TradeRecord
 *
 * Failure-soft pattern: when KV is unavailable, mutating calls return
 * { ok: false, reason: "kv_unavailable" } and readers return empty
 * collections. Mirrors the digest-archive pattern from v2.0-E.
 */

import { randomBytes } from "node:crypto";
import { getKv } from "@/lib/data/kv";
import { loadWatchlist } from "@/lib/thesis/load";
import {
  NewTradeInput,
  TradeRecord,
  UpdateTradeInput,
  type DerivedStats,
  type SetupStats,
} from "./schema";

const SET_KEY = "journal:set";
const itemKey = (id: string) => `journal:${id}`;

/**
 * Lexically-sortable ID: 13-digit ms timestamp + 8 hex chars of randomness.
 * Newest IDs sort to the end, so `[...set].sort()` returns ascending order
 * without needing a separate timestamp lookup. No external dep.
 */
function generateId(): string {
  return Date.now().toString().padStart(13, "0") + randomBytes(4).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type ArchiveResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export async function listTrades(limit?: number): Promise<TradeRecord[]> {
  const kv = getKv();
  if (!kv) return [];
  try {
    const ids = ((await kv.smembers(SET_KEY)) as string[]) ?? [];
    if (ids.length === 0) return [];
    const sorted = [...ids].sort().reverse(); // newest first
    const slice = limit && limit > 0 ? sorted.slice(0, limit) : sorted;
    const records = await Promise.all(
      slice.map((id) => kv.get<TradeRecord>(itemKey(id))),
    );
    return records.filter((r): r is TradeRecord => r !== null);
  } catch (e) {
    console.error(`[journal] list failed: ${(e as Error).message}`);
    return [];
  }
}

export async function addTrade(
  input: NewTradeInput,
): Promise<ArchiveResult<TradeRecord>> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };

  const parsed = NewTradeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: `invalid: ${parsed.error.issues[0]?.message}` };
  }
  const id = generateId();
  const now = nowIso();
  const record: TradeRecord = TradeRecord.parse({
    ...parsed.data,
    id,
    created_at: now,
    updated_at: now,
  });

  try {
    await kv.set(itemKey(id), record);
    await kv.sadd(SET_KEY, id);
    return { ok: true, data: record };
  } catch (e) {
    console.error(`[journal] add failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

export async function getTrade(id: string): Promise<TradeRecord | null> {
  const kv = getKv();
  if (!kv) return null;
  try {
    return (await kv.get<TradeRecord>(itemKey(id))) ?? null;
  } catch {
    return null;
  }
}

export async function updateTrade(
  id: string,
  patch: UpdateTradeInput,
): Promise<ArchiveResult<TradeRecord>> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };

  const current = await getTrade(id);
  if (!current) return { ok: false, reason: "not_found" };

  const parsedPatch = UpdateTradeInput.safeParse(patch);
  if (!parsedPatch.success) {
    return {
      ok: false,
      reason: `invalid: ${parsedPatch.error.issues[0]?.message}`,
    };
  }

  // H3 (GSD review): UpdateTradeInput.partial() can't forbid exit fields on
  // an "open" merged record at schema time (every field is optional). Strip
  // stale exit_date / exit_price here on the closed → open transition so the
  // /journal table never renders OPEN with carry-over exit values, and so
  // computeStats correctly skips this trade for R-multiple math.
  const mergedRaw: Record<string, unknown> = {
    ...current,
    ...parsedPatch.data,
    id,
    updated_at: nowIso(),
  };
  if (mergedRaw.status === "open") {
    mergedRaw.exit_date = undefined;
    mergedRaw.exit_price = undefined;
  }
  const merged = TradeRecord.safeParse(mergedRaw);
  if (!merged.success) {
    return {
      ok: false,
      reason: `invariant: ${merged.error.issues[0]?.message}`,
    };
  }

  try {
    await kv.set(itemKey(id), merged.data);
    return { ok: true, data: merged.data };
  } catch (e) {
    console.error(`[journal] update failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

export async function removeTrade(
  id: string,
): Promise<ArchiveResult<{ id: string }>> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };
  try {
    await kv.del(itemKey(id));
    await kv.srem(SET_KEY, id);
    return { ok: true, data: { id } };
  } catch (e) {
    console.error(`[journal] remove failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

// ---------------------------------------------------------------------------
// R-multiple resolution + stats
// ---------------------------------------------------------------------------

/**
 * Resolves the risk denominator (entry - stop, for long; reversed for short).
 * Order: explicit stop_price → watchlist thesis invalidation_price → null.
 *
 * `thesisInvalidationByTicker` is an in-memory map populated once per stats
 * computation so we don't re-read the YAML for every trade.
 */
function computeRForTrade(
  t: TradeRecord,
  thesisInvalidationByTicker: Map<string, number>,
): number | null {
  if (t.status !== "closed" || t.exit_price == null) return null;
  let stop: number | null = t.stop_price ?? null;
  if (stop == null && t.watchlist_thesis_ticker) {
    const inv = thesisInvalidationByTicker.get(
      t.watchlist_thesis_ticker.toUpperCase(),
    );
    if (inv != null) stop = inv;
  }
  if (stop == null) return null;

  const direction = t.side === "short" ? -1 : 1;
  const risk = (t.entry_price - stop) * direction;
  if (risk <= 0) return null; // degenerate setup, skip
  return ((t.exit_price - t.entry_price) * direction) / risk;
}

function dollarPnL(t: TradeRecord): number | null {
  if (t.status !== "closed" || t.exit_price == null) return null;
  const direction = t.side === "short" ? -1 : 1;
  return (t.exit_price - t.entry_price) * direction * t.shares;
}

export async function computeStats(
  trades: TradeRecord[],
): Promise<DerivedStats> {
  // One YAML read per stats call. Builds a ticker → invalidation_price map.
  const thesisInvalidationByTicker = new Map<string, number>();
  try {
    const { watchlist } = await loadWatchlist();
    for (const t of watchlist.tickers) {
      if (t.thesis) {
        thesisInvalidationByTicker.set(
          t.ticker.toUpperCase(),
          t.thesis.invalidation_price,
        );
      }
    }
  } catch {
    // KV-mode persisted journal can outlive YAML changes; missing → no R lookups
  }

  const n = trades.length;
  const closed = trades.filter((t) => t.status === "closed");
  const closedN = closed.length;
  const openN = n - closedN;

  const closedWithR = closed
    .map((t) => ({ t, r: computeRForTrade(t, thesisInvalidationByTicker) }))
    .filter((x): x is { t: TradeRecord; r: number } => x.r !== null);

  // H2b (GSD review): pushes (r === 0) are excluded from BOTH win and loss
  // buckets. They still count toward `closedWithRn` so totals are honest, but
  // `winRate` is computed over decisive trades only (wins + losses), and the
  // expectancy formula's `lossProb` is the symmetric complement.
  const closedWithRn = closedWithR.length;
  const wins = closedWithR.filter((x) => x.r > 0).length;
  const losses = closedWithR.filter((x) => x.r < 0).length;
  const decisive = wins + losses;
  const winRate = decisive === 0 ? 0 : wins / decisive;
  const avgR =
    closedWithRn === 0
      ? 0
      : closedWithR.reduce((s, x) => s + x.r, 0) / closedWithRn;

  // Total dollar P&L across all closed trades (regardless of whether R could
  // be computed — risk-less recap of money).
  const totalPnL = closed.reduce((s, t) => s + (dollarPnL(t) ?? 0), 0);

  // Expectancy (H2b): among R-eligible *decisive* closed trades, the standard
  // per-trade R-expectancy. Pushes contribute 0 to both halves and are
  // dropped from the probability denominator.
  const rWins = closedWithR.filter((x) => x.r > 0).map((x) => x.r);
  const rLosses = closedWithR.filter((x) => x.r < 0).map((x) => x.r);
  const avgWin =
    rWins.length === 0 ? 0 : rWins.reduce((s, r) => s + r, 0) / rWins.length;
  const avgLoss =
    rLosses.length === 0
      ? 0
      : rLosses.reduce((s, r) => s + r, 0) / rLosses.length;
  const lossProb = decisive === 0 ? 0 : losses / decisive;
  const expectancy = winRate * avgWin + lossProb * avgLoss;

  // Per-setup breakdown across all trades (open + closed). Empty for trades
  // without setup_at_entry — they aggregate under "UNSET".
  const bySetup: Record<string, SetupStats> = {};
  for (const t of trades) {
    const key = t.setup_at_entry ?? "UNSET";
    const cur = bySetup[key] ?? { n: 0, winRate: 0, avgR: 0 };
    cur.n += 1;
    bySetup[key] = cur;
  }
  // Compute per-setup winRate + avgR from closedWithR scoped to that setup.
  // H2b (GSD review): winRate denominator is decisive trades only (pushes
  // excluded), mirroring the top-level computation above. avgR still
  // averages over all R-eligible trades — a push of 0 contributes 0, which
  // is its correct R-contribution.
  for (const key of Object.keys(bySetup)) {
    const setupClosed = closedWithR.filter(
      (x) => (x.t.setup_at_entry ?? "UNSET") === key,
    );
    if (setupClosed.length === 0) {
      bySetup[key]!.winRate = 0;
      bySetup[key]!.avgR = 0;
      continue;
    }
    const setupWins = setupClosed.filter((x) => x.r > 0).length;
    const setupLosses = setupClosed.filter((x) => x.r < 0).length;
    const setupDecisive = setupWins + setupLosses;
    bySetup[key]!.winRate =
      setupDecisive === 0 ? 0 : setupWins / setupDecisive;
    bySetup[key]!.avgR =
      setupClosed.reduce((s, x) => s + x.r, 0) / setupClosed.length;
  }

  return {
    n,
    openN,
    closedN,
    closedWithRn,
    winRate,
    avgR,
    totalPnL,
    expectancy,
    bySetup,
  };
}

/** Convenience: list + stats in one server-side call. */
export async function loadJournal(): Promise<{
  trades: TradeRecord[];
  stats: DerivedStats;
}> {
  const trades = await listTrades();
  const stats = await computeStats(trades);
  return { trades, stats };
}

/** Stats limited to trades closed within the last N calendar days. Used by
 *  the Friday Slack digest. */
export async function loadWeeklyStats(days = 7): Promise<DerivedStats> {
  const trades = await listTrades();
  // H1 (GSD review): `(today - days).slice(0,10)` is a calendar date string,
  // and a `>=` filter would include that boundary date — yielding N+1 distinct
  // calendar dates for `days=7` (today plus seven prior). Using `>` produces
  // exactly N calendar dates beyond the cutoff, matching the "last 7 days"
  // promise of the Friday Slack "Week in trades" section.
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  const recent = trades.filter(
    (t) => t.status === "closed" && (t.exit_date ?? "") > cutoffDate,
  );
  return computeStats(recent);
}
