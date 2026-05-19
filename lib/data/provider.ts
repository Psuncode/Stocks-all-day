import type { UniverseSymbol } from "@/lib/types";
import { fetchUniverseFromScreener, fetchSymbol } from "@/lib/data/yahoo";
import { fetchScreenerUniverse, preFilter, FALLBACK_TICKERS, UTAH_TICKERS } from "@/lib/data/screener";
import type { ScreenerQuote } from "@/lib/data/screener";
import { MemCache } from "@/lib/data/cache";

// GSD review L1: hot-path logs are noisy in Vercel; gate behind DEBUG_DATA
// so the daily cron + page renders aren't dumping caching internals.
const debug = process.env.DEBUG_DATA ? console.log : () => {};

export type DataProvider = {
  getUniverse(): Promise<UniverseSymbol[]>;
  getSymbol(ticker: string): Promise<UniverseSymbol | null>;
};

const screenerCache = new MemCache<ScreenerQuote[]>(2 * 60 * 1000); // 2-min TTL
const universeCache = new MemCache<UniverseSymbol[]>();              // 5-min TTL
const symbolCache = new MemCache<Map<string, UniverseSymbol>>();     // 5-min TTL

export function getProvider(): DataProvider {
  return {
    async getUniverse() {
      const cached = universeCache.get();
      if (cached) return cached;

      // Phase 1: Screener discovery
      let screenerQuotes = screenerCache.get();
      if (!screenerQuotes) {
        screenerQuotes = await fetchScreenerUniverse();
        screenerCache.set(screenerQuotes);
      }

      // Pre-filter to candidates
      const candidates = preFilter(screenerQuotes);

      // Fallback if screener returned nothing usable. fetchFallbackUniverse
      // reads FALLBACK_TICKERS internally; we don't need to construct
      // synthetic ScreenerQuote stubs anymore (GSD review pass 2 H1.5:
      // those stubs were never read).
      const usingFallback = candidates.length === 0;
      if (usingFallback) {
        console.warn("[provider] No screener candidates, using fallback tickers");
      }

      // Phase 2: Detail fetch for qualifying stocks
      const universe = usingFallback
        ? await fetchFallbackUniverse()
        : await fetchUniverseFromScreener(candidates);

      // Phase 3: Merge always-include Utah tickers not already in universe
      const found = new Set(universe.map((s) => s.meta.ticker.toUpperCase()));
      const missingUtah = UTAH_TICKERS.filter((t) => !found.has(t.toUpperCase()));
      if (missingUtah.length > 0) {
        const utahResults = await Promise.all(missingUtah.map((t) => fetchSymbol(t)));
        for (const r of utahResults) {
          if (r) universe.push(r);
        }
        debug(`[provider] Added ${utahResults.filter(Boolean).length}/${missingUtah.length} Utah tickers`);
      }

      universeCache.set(universe);

      // Populate symbol cache
      const map = symbolCache.get() ?? new Map<string, UniverseSymbol>();
      for (const s of universe) map.set(s.meta.ticker.toUpperCase(), s);
      symbolCache.set(map);

      return universe;
    },

    async getSymbol(ticker: string) {
      const key = ticker.toUpperCase();

      // Check symbol cache first
      const map = symbolCache.get();
      if (map?.has(key)) return map.get(key)!;

      // On-demand fetch for any valid ticker
      const symbol = await fetchSymbol(ticker);
      if (symbol) {
        const m = symbolCache.get() ?? new Map<string, UniverseSymbol>();
        m.set(key, symbol);
        symbolCache.set(m);
      }
      return symbol;
    },
  };
}

/** Fallback: use fetchSymbol (3 calls each) for hardcoded tickers */
async function fetchFallbackUniverse(): Promise<UniverseSymbol[]> {
  const results = await Promise.all(
    FALLBACK_TICKERS.map((t) => fetchSymbol(t)),
  );
  return results.filter((r): r is UniverseSymbol => r !== null);
}
