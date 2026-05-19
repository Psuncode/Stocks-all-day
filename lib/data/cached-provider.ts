/**
 * Cached wrappers around the live data provider for server-component pages.
 *
 * The provider's in-process MemCache survives only within a single
 * serverless function invocation. On Vercel every cold start reloads
 * Yahoo Finance from scratch — multi-second TTFB on /watchlist and
 * /symbol/[ticker]. unstable_cache backs cached values with Vercel's
 * Data Cache so they persist across invocations.
 *
 * Cron path does NOT use these — invalidation evaluation and the daily
 * digest need fresh end-of-day candles.
 */

import { unstable_cache } from "next/cache";
import { getProvider } from "./provider";
import { fetchSpyCandles } from "./yahoo";
import type { Candle, UniverseSymbol } from "@/lib/types";

const TTL_SECONDS = 15 * 60;

export const getCachedSpy = unstable_cache(
  async (): Promise<Candle[]> => fetchSpyCandles(),
  ["cached-spy-v1"],
  { revalidate: TTL_SECONDS, tags: ["spy"] },
);

export const getCachedSymbol = unstable_cache(
  async (ticker: string): Promise<UniverseSymbol | null> => {
    return getProvider().getSymbol(ticker);
  },
  ["cached-symbol-v1"],
  { revalidate: TTL_SECONDS, tags: ["symbols"] },
);

export const getCachedUniverse = unstable_cache(
  async (): Promise<UniverseSymbol[]> => {
    return getProvider().getUniverse();
  },
  ["cached-universe-v1"],
  { revalidate: TTL_SECONDS, tags: ["universe"] },
);
