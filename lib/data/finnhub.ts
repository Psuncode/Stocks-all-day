/**
 * Finnhub company-news fetcher for the `news_match` invalidation rule.
 *
 * Free tier: 60 req/min, no symbol restrictions on company-news.
 * Endpoint: GET /company-news?symbol=AAPL&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Failure-soft contract (mirrors lib/data/fred.ts):
 *   - If FINNHUB_API_KEY is unset, return [].
 *   - If a fetch fails or the response is malformed, return [].
 *   - Never throw — callers feed this directly into the rule evaluator.
 *
 * Caching: wrapped in unstable_cache with a 1-hour TTL.
 */

import { unstable_cache } from "next/cache";

export type NewsItem = {
  headline: string;
  source: string;
  url: string;
  /** Unix seconds */
  datetime: number;
};

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const CACHE_TTL_SECONDS = 60 * 60;

type FinnhubNewsRaw = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

async function fetchCompanyNewsUncached(
  ticker: string,
  sinceDate: string,
): Promise<NewsItem[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return [];

  const today = new Date().toISOString().slice(0, 10);
  const url =
    `${FINNHUB_BASE}/company-news` +
    `?symbol=${encodeURIComponent(ticker)}` +
    `&from=${encodeURIComponent(sinceDate)}` +
    `&to=${encodeURIComponent(today)}` +
    `&token=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[finnhub] company-news ${ticker} HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as FinnhubNewsRaw[] | { error?: string };
    if (!Array.isArray(json)) return [];
    return json
      .filter(
        (n): n is FinnhubNewsRaw =>
          typeof n.headline === "string" && n.headline.length > 0,
      )
      .map((n) => ({
        headline: n.headline!,
        source: n.source ?? "",
        url: n.url ?? "",
        datetime: typeof n.datetime === "number" ? n.datetime : 0,
      }));
  } catch (err) {
    console.warn("[finnhub] company-news fetch failed:", err);
    return [];
  }
}

export const fetchCompanyNews = unstable_cache(
  fetchCompanyNewsUncached,
  ["finnhub-company-news-v1"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["finnhub-news"] },
);
