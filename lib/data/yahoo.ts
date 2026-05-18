import YahooFinance from "yahoo-finance2";
import type { Candle, Quote, UniverseSymbol } from "@/lib/types";
import { MemCache } from "@/lib/data/cache";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Simple concurrency-limited parallel map. */
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCandle(bar: any): Candle | null {
  if (
    bar.open == null ||
    bar.high == null ||
    bar.low == null ||
    bar.close == null ||
    bar.volume == null
  )
    return null;
  return {
    t: formatYmd(bar.date),
    o: Math.round(bar.open * 100) / 100,
    h: Math.round(bar.high * 100) / 100,
    l: Math.round(bar.low * 100) / 100,
    c: Math.round(bar.close * 100) / 100,
    v: Math.round(bar.volume),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQuote(q: any): Quote {
  const last = q.regularMarketPrice ?? 0;
  let bid = q.bid ?? 0;
  let ask = q.ask ?? 0;
  // Outside market hours bid/ask may be 0 — use synthetic spread
  if (bid === 0 || ask === 0) {
    bid = Math.round(last * 0.999 * 100) / 100;
    ask = Math.round(last * 1.001 * 100) / 100;
  }
  return { last, bid, ask, updatedAt: new Date().toISOString() };
}

const SECTOR_MAP: Record<string, string> = {
  "Financial Services": "Financials",
  "Consumer Cyclical": "Consumer",
  "Consumer Defensive": "Consumer",
  "Communication Services": "Communication",
  "Basic Materials": "Materials",
  Industrials: "Industrials",
  Technology: "Technology",
  Healthcare: "Healthcare",
  Energy: "Energy",
  "Real Estate": "REITs",
  Utilities: "Utilities",
};

function normalizeSector(yahooSector: string | undefined): string {
  if (!yahooSector) return "Other";
  return SECTOR_MAP[yahooSector] ?? yahooSector;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEarningsDate(calendarEvents: any): string | null {
  const dates = calendarEvents?.earnings?.earningsDate;
  if (!dates || dates.length === 0) return null;
  return formatYmd(dates[0]!);
}

function detectCatalyst(candles: Candle[], earningsDate: string | null): boolean {
  if (candles.length < 21) return false;
  const last = candles[candles.length - 1]!;
  const avg20 =
    candles.slice(-21, -1).reduce((sum, c) => sum + c.v, 0) / 20;
  // Volume spike: last day > 2x 20-day average
  if (last.v > avg20 * 2) return true;
  // Earnings within 30 days
  if (earningsDate) {
    const now = new Date(`${last.t}T00:00:00Z`).getTime();
    const earn = new Date(`${earningsDate}T00:00:00Z`).getTime();
    if (Math.abs(earn - now) <= 30 * 24 * 60 * 60 * 1000) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fetch single symbol
// ---------------------------------------------------------------------------

export async function fetchSymbol(ticker: string): Promise<UniverseSymbol | null> {
  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 400); // ~260 trading days

    const summaryPromise: Promise<Record<string, unknown> | null> = yf
      .quoteSummary(ticker, {
        modules: ["quoteType", "assetProfile", "calendarEvents"],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((r: any) => r as Record<string, unknown> | null)
      .catch((): null => null);

    const [chartResult, quoteResult, summaryResult] = await Promise.all([
      yf.chart(ticker, { period1, interval: "1d" }),
      yf.quote(ticker),
      summaryPromise,
    ]);

    // Map candles, filtering nulls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes = (chartResult as any).quotes ?? [];
    const candles = quotes
      .map((bar: unknown) => toCandle(bar))
      .filter((c: Candle | null): c is Candle => c !== null);

    if (candles.length < 50) return null; // not enough data

    const quote = toQuote(quoteResult);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = summaryResult as any;
    const sector = normalizeSector(summary?.assetProfile?.sector);
    const name =
      summary?.quoteType?.shortName ??
      summary?.quoteType?.longName ??
      (quoteResult as any).shortName ??
      (quoteResult as any).longName ??
      ticker;
    const earningsDate = toEarningsDate(summary?.calendarEvents);
    const hasCatalyst = detectCatalyst(candles, earningsDate);

    return {
      meta: { ticker: ticker.toUpperCase(), name, sector },
      candles,
      quote,
      earningsDate,
      hasCatalyst,
    };
  } catch (e) {
    console.error(`[yahoo] Failed to fetch ${ticker}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Screener-based symbol detail (2 calls instead of 3)
// ---------------------------------------------------------------------------

import type { ScreenerQuote } from "@/lib/data/screener";

export function screenerToQuote(sq: ScreenerQuote): Quote {
  const last = sq.price;
  let bid = sq.bid;
  let ask = sq.ask;
  if (bid === 0 || ask === 0) {
    bid = Math.round(last * 0.999 * 100) / 100;
    ask = Math.round(last * 1.001 * 100) / 100;
  }
  return { last, bid, ask, updatedAt: new Date().toISOString() };
}

function epochToYmd(epoch: number): string {
  return formatYmd(new Date(epoch * 1000));
}

export async function fetchSymbolDetail(
  sq: ScreenerQuote,
): Promise<UniverseSymbol | null> {
  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 400);

    const summaryPromise: Promise<Record<string, unknown> | null> = yf
      .quoteSummary(sq.ticker, { modules: ["assetProfile"] })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((r: any) => r as Record<string, unknown> | null)
      .catch((): null => null);

    const [chartResult, summaryResult] = await Promise.all([
      yf.chart(sq.ticker, { period1, interval: "1d" }),
      summaryPromise,
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes = (chartResult as any).quotes ?? [];
    const candles = quotes
      .map((bar: unknown) => toCandle(bar))
      .filter((c: Candle | null): c is Candle => c !== null);

    if (candles.length < 50) return null;

    const quote = screenerToQuote(sq);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = summaryResult as any;
    const sector = normalizeSector(summary?.assetProfile?.sector);
    const earningsDate = sq.earningsTimestamp ? epochToYmd(sq.earningsTimestamp) : null;
    const hasCatalyst = detectCatalyst(candles, earningsDate);

    return {
      meta: { ticker: sq.ticker.toUpperCase(), name: sq.name, sector },
      candles,
      quote,
      earningsDate,
      hasCatalyst,
    };
  } catch (e) {
    console.error(`[yahoo] Detail fetch failed for ${sq.ticker}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchUniverseFromScreener(
  screenerQuotes: ScreenerQuote[],
): Promise<UniverseSymbol[]> {
  const results = await pMap(screenerQuotes, fetchSymbolDetail, 8);
  return results.filter((r): r is UniverseSymbol => r !== null);
}

// ---------------------------------------------------------------------------
// SPY candles (cached)
// ---------------------------------------------------------------------------

const spyCache = new MemCache<Candle[]>();

export async function fetchSpyCandles(): Promise<Candle[]> {
  const cached = spyCache.get();
  if (cached) return cached;

  const period1 = new Date();
  period1.setDate(period1.getDate() - 400);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartResult: any = await yf.chart("SPY", { period1, interval: "1d" });

  const candles = (chartResult.quotes ?? [])
    .map((bar: unknown) => toCandle(bar))
    .filter((c: Candle | null): c is Candle => c !== null);

  return spyCache.set(candles);
}
