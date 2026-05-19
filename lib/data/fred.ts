/**
 * FRED (Federal Reserve Economic Data) fetcher for the macro context strip.
 *
 * The strip surfaces three regime indicators:
 *   - VIXCLS — CBOE Volatility Index (daily close)
 *   - DGS10  — 10-Year Treasury Constant Maturity Rate
 *   - DFF    — Federal Funds Effective Rate
 *
 * FRED's JSON observation endpoint requires an API key (free, registered):
 *   https://fred.stlouisfed.org/docs/api/api_key.html
 *
 * Failure-soft contract:
 *   - If FRED_API_KEY is unset, return null (strip hidden by component).
 *   - If a fetch fails or returns no usable observations, return null.
 *   - Never throw — callers (server components) embed this in render paths.
 *
 * Caching: wrapped in unstable_cache with a 1-hour TTL. The data updates
 * daily after the close, so an hourly cache is well-fitted and keeps us
 * far below any plausible rate limit.
 */

import { unstable_cache } from "next/cache";

export type MacroSnapshot = {
  vix: { value: number; change5d: number | null };
  yield10y: { value: number; change5d: number | null };
  fedFunds: { value: number };
  fetchedAt: string;
} | null;

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

type FredObservation = {
  date: string;
  value: string; // FRED returns numbers as strings; "." means missing
};

type FredResponse = {
  observations?: FredObservation[];
};

/**
 * Returns the most recent N valid (non-".") observations for a series,
 * ordered chronologically ascending (oldest → newest).
 */
async function fetchSeries(
  seriesId: string,
  apiKey: string,
  limit: number,
): Promise<number[]> {
  // Pull the last ~30 calendar days to comfortably cover 5 trading days.
  const observationStart = new Date();
  observationStart.setDate(observationStart.getDate() - 30);
  const startStr = observationStart.toISOString().slice(0, 10);

  const url =
    `${FRED_BASE}?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json` +
    `&observation_start=${startStr}` +
    `&sort_order=desc` +
    `&limit=${limit + 10}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Layered cache: Next's Data Cache wraps this fetch via unstable_cache.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  }

  const json = (await res.json()) as FredResponse;
  const obs = json.observations ?? [];

  // Filter missing markers ("."), parse, keep newest first.
  const valid = obs
    .filter((o) => o.value !== "." && o.value !== "")
    .map((o) => Number(o.value))
    .filter((n) => Number.isFinite(n))
    .slice(0, limit);

  // Return ascending so callers can take last() as "current".
  return valid.reverse();
}

async function fetchMacroSnapshotUncached(): Promise<MacroSnapshot> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;

  try {
    const [vix, ten, ff] = await Promise.all([
      fetchSeries("VIXCLS", apiKey, 6),
      fetchSeries("DGS10", apiKey, 6),
      fetchSeries("DFF", apiKey, 2),
    ]);

    if (vix.length === 0 || ten.length === 0 || ff.length === 0) {
      return null;
    }

    const vixCurrent = vix[vix.length - 1];
    const vix5dAgo = vix.length >= 6 ? vix[vix.length - 6] : null;
    const tenCurrent = ten[ten.length - 1];
    const ten5dAgo = ten.length >= 6 ? ten[ten.length - 6] : null;
    const ffCurrent = ff[ff.length - 1];

    return {
      vix: {
        value: vixCurrent,
        change5d: vix5dAgo === null ? null : vixCurrent - vix5dAgo,
      },
      yield10y: {
        value: tenCurrent,
        change5d: ten5dAgo === null ? null : tenCurrent - ten5dAgo,
      },
      fedFunds: { value: ffCurrent },
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn("[fred] macro snapshot fetch failed:", err);
    return null;
  }
}

export const getMacroSnapshot = unstable_cache(
  fetchMacroSnapshotUncached,
  ["fred-macro-snapshot-v1"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["fred-macro"] },
);
