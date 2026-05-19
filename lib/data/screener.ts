import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// GSD review L1: gate verbose discovery logs behind DEBUG_DATA.
const debug = process.env.DEBUG_DATA ? console.log : () => {};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenerQuote = {
  ticker: string;
  name: string;
  price: number;
  bid: number;
  ask: number;
  avgVolume3m: number;
  earningsTimestamp: number | null;
};

// ---------------------------------------------------------------------------
// Screener IDs to combine for broad market coverage
// ---------------------------------------------------------------------------

const SCREENER_IDS = [
  "most_actives",              // high volume
  "day_gainers",               // momentum up
  "day_losers",                // oversold bounce candidates
  "most_shorted_stocks",       // short squeeze candidates
  "aggressive_small_caps",     // small cap growth
  "undervalued_growth_stocks", // value + growth
] as const;

/** Safety net if all screeners fail */
const FALLBACK_TICKERS = [
  "PLTR", "RBLX", "SOFI", "HOOD", "SNAP", "PINS", "AFRM", "NU",
  "DKNG", "RIVN", "ROKU", "CLF", "AA", "X", "RIG", "DAL", "UAL",
  "NCLH", "HIMS", "DUOL",
];

// ---------------------------------------------------------------------------
// Fetch one predefined screener
// ---------------------------------------------------------------------------

/**
 * Yahoo's `earningsTimestamp` from the screener (with validateResult: false)
 * arrives as a NUMBER in seconds since epoch. The previous mapping
 *   new Date(seconds).getTime() / 1000
 * misinterprets that number as ms, landing every earnings date in 1970 and
 * silently breaking the EVENT gate for screener-discovered tickers.
 * GSD review H2.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEpochSeconds(raw: any): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    // Heuristic: anything > 10^11 is almost certainly ms; otherwise seconds.
    return Math.floor(raw > 1e11 ? raw / 1000 : raw);
  }
  if (raw instanceof Date) return Math.floor(raw.getTime() / 1000);
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuote(raw: any): ScreenerQuote {
  return {
    ticker: raw.symbol ?? "",
    name: raw.shortName ?? raw.longName ?? raw.symbol ?? "",
    price: raw.regularMarketPrice ?? 0,
    bid: raw.bid ?? 0,
    ask: raw.ask ?? 0,
    avgVolume3m: raw.averageDailyVolume3Month ?? 0,
    earningsTimestamp: toEpochSeconds(raw.earningsTimestamp),
  };
}

async function fetchOneScreener(id: string): Promise<ScreenerQuote[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (yf.screener as any)(id, { count: 250 }, { validateResult: false });
    const quotes = result.quotes ?? [];
    return quotes.map(mapQuote);
  } catch (e) {
    console.warn(`[screener] ${id} failed:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fetch all screeners, merge, deduplicate
// ---------------------------------------------------------------------------

export async function fetchScreenerUniverse(): Promise<ScreenerQuote[]> {
  const results = await Promise.all(SCREENER_IDS.map(fetchOneScreener));
  const all = results.flat();

  // Deduplicate by ticker — keep first occurrence
  const seen = new Map<string, ScreenerQuote>();
  for (const q of all) {
    if (q.ticker && !seen.has(q.ticker)) {
      seen.set(q.ticker, q);
    }
  }

  const universe = [...seen.values()];
  debug(
    `[screener] Discovered ${universe.length} unique tickers from ${SCREENER_IDS.length} screeners`,
  );
  return universe;
}

// ---------------------------------------------------------------------------
// Pre-filter: price range + ADV$ floor
// ---------------------------------------------------------------------------

export function preFilter(quotes: ScreenerQuote[]): ScreenerQuote[] {
  const filtered = quotes.filter((q) => {
    if (q.price < 5 || q.price > 100) return false;
    const advUsd = q.avgVolume3m * q.price;
    if (advUsd < 5_000_000) return false;
    return true;
  });
  debug(`[screener] Pre-filter: ${quotes.length} → ${filtered.length} candidates`);
  return filtered;
}

// ---------------------------------------------------------------------------
// Utah always-include tickers
// ---------------------------------------------------------------------------

export const UTAH_TICKERS = [
  // Silicon Slopes / Utah tech
  "DOMO",   // Domo Inc — American Fork
  "HCAT",   // Health Catalyst — South Jordan
  "RXRX",   // Recursion Pharmaceuticals — Salt Lake City
  "WEAV",   // Weave Communications — Lehi
  "PRPL",   // Purple Innovation — Lehi
  "COOK",   // Traeger — Salt Lake City
  "NATR",   // Nature's Sunshine — Lehi
  // Utah financials / industrials
  "ZION",   // Zions Bancorporation — Salt Lake City
  "SKYW",   // SkyWest Inc — St. George
  "NUS",    // Nu Skin Enterprises — Provo
  // Additional Utah-based
  "CLAR",   // Clarus Corp — Salt Lake City
  "CODX",   // Co-Diagnostics — Salt Lake City
  "CLNN",   // Clene Nanomedicine — Salt Lake City
];

// ---------------------------------------------------------------------------
// Fallback tickers (exported for provider.ts)
// ---------------------------------------------------------------------------

export { FALLBACK_TICKERS };
