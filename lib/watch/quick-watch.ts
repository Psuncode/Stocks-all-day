/**
 * Quick-watch store (Feature F) — KV-backed, complementary to
 * data/watchlist.yaml.
 *
 * The YAML file is for considered theses (entry/exit targets, invalidation
 * rules). Quick-watch is for "I tapped 👁 on the scanner just now" — fast,
 * fuzzy, no thesis required. The /watchlist page merges both with a
 * separate section per source.
 *
 * Storage layout (Upstash Redis):
 *   quickwatch:set    →  Redis SET of normalized tickers
 *   quickwatch:<TICK> →  JSON metadata { ticker, name, sector, added_at,
 *                                        decision_at_add, setup_at_add }
 */

import { getKv } from "@/lib/data/kv";

export type QuickWatchEntry = {
  ticker: string;
  name: string;
  sector: string;
  added_at: string;            // ISO
  decision_at_add: string;
  setup_at_add: string;
};

const SET_KEY = "quickwatch:set";
const entryKey = (ticker: string) => `quickwatch:${ticker.toUpperCase()}`;

function normalize(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}

export async function listQuickWatch(): Promise<QuickWatchEntry[]> {
  const kv = getKv();
  if (!kv) return [];
  try {
    const tickers = (await kv.smembers(SET_KEY)) as string[];
    if (!tickers || tickers.length === 0) return [];
    const entries = await Promise.all(
      tickers.map((t) => kv.get<QuickWatchEntry>(entryKey(t))),
    );
    return entries
      .filter((e): e is QuickWatchEntry => e !== null)
      .sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
  } catch (e) {
    console.error(`[quick-watch] list failed: ${(e as Error).message}`);
    return [];
  }
}

export async function addQuickWatch(
  entry: Omit<QuickWatchEntry, "added_at"> & { added_at?: string },
): Promise<{ ok: boolean; reason?: string }> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };
  const ticker = normalize(entry.ticker);
  if (!ticker) return { ok: false, reason: "invalid_ticker" };

  const record: QuickWatchEntry = {
    ticker,
    name: entry.name,
    sector: entry.sector,
    added_at: entry.added_at ?? new Date().toISOString(),
    decision_at_add: entry.decision_at_add,
    setup_at_add: entry.setup_at_add,
  };
  try {
    await kv.set(entryKey(ticker), record);
    await kv.sadd(SET_KEY, ticker);
    return { ok: true };
  } catch (e) {
    console.error(`[quick-watch] add failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

export async function removeQuickWatch(
  ticker: string,
): Promise<{ ok: boolean; reason?: string }> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };
  const t = normalize(ticker);
  if (!t) return { ok: false, reason: "invalid_ticker" };
  try {
    await kv.del(entryKey(t));
    await kv.srem(SET_KEY, t);
    return { ok: true };
  } catch (e) {
    console.error(`[quick-watch] remove failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

/**
 * Atomic toggle (GSD review pass 3 H2). Single SADD call decides outcome:
 *   - if SADD returns 1, the ticker was NOT in the set; we've just added
 *     it. Write the metadata record and report "added".
 *   - if SADD returns 0, the ticker was already in the set; treat the
 *     POST as a remove and report "removed".
 *
 * Two concurrent toggles from different tabs are now well-defined: each
 * sees a different SADD return value, so the final state is deterministic
 * (the second click flips back). Prior read-then-branch could let both
 * concurrent adds succeed silently.
 */
export async function toggleQuickWatch(
  entry: Omit<QuickWatchEntry, "added_at"> & { added_at?: string },
): Promise<{ ok: boolean; action?: "added" | "removed"; reason?: string }> {
  const kv = getKv();
  if (!kv) return { ok: false, reason: "kv_unavailable" };
  const ticker = normalize(entry.ticker);
  if (!ticker) return { ok: false, reason: "invalid_ticker" };

  const record: QuickWatchEntry = {
    ticker,
    name: entry.name,
    sector: entry.sector,
    added_at: entry.added_at ?? new Date().toISOString(),
    decision_at_add: entry.decision_at_add,
    setup_at_add: entry.setup_at_add,
  };

  try {
    const added = (await kv.sadd(SET_KEY, ticker)) as number;
    if (added === 1) {
      await kv.set(entryKey(ticker), record);
      return { ok: true, action: "added" };
    }
    // already present → flip to removed
    await kv.del(entryKey(ticker));
    await kv.srem(SET_KEY, ticker);
    return { ok: true, action: "removed" };
  } catch (e) {
    console.error(`[quick-watch] toggle failed: ${(e as Error).message}`);
    return { ok: false, reason: "kv_write_error" };
  }
}

export async function listTickerSet(): Promise<Set<string>> {
  const kv = getKv();
  if (!kv) return new Set();
  try {
    const tickers = (await kv.smembers(SET_KEY)) as string[];
    return new Set(tickers.map((t) => t.toUpperCase()));
  } catch {
    return new Set();
  }
}
