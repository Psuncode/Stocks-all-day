/**
 * User-preference biases for the digest + scanner (v1.6).
 *
 * The user said: "I tend to want to invest in something I can understand —
 * I lean toward healthcare. Utah company." We encode that as two soft
 * preferences that surface matching candidates earlier in the digest and
 * provide toggle chips in the scanner.
 *
 * Hard rules belong in the engine. Soft preferences belong here — they
 * never block a pick, just rank it higher.
 */

import { UTAH_TICKERS } from "@/lib/data/screener";

const UTAH_SET = new Set(UTAH_TICKERS.map((t) => t.toUpperCase()));

export function isUtahTicker(ticker: string): boolean {
  return UTAH_SET.has(ticker.toUpperCase());
}

const HEALTHCARE_SECTORS = new Set(
  [
    "Healthcare",
    "Health Care",
    "Pharmaceuticals",
    "Biotechnology",
    "Medical Devices",
    "Health Care Equipment & Services",
  ].map((s) => s.toLowerCase()),
);

export function isHealthcareSector(sector: string | null | undefined): boolean {
  if (!sector) return false;
  const lower = sector.toLowerCase();
  if (HEALTHCARE_SECTORS.has(lower)) return true;
  // Yahoo sometimes returns sub-sector strings; do a contains check as a
  // fallback so we still catch "Healthcare Services" / "Health Care Plans".
  return lower.includes("health") || lower.includes("pharma") || lower.includes("bio");
}

export function preferenceScore(opts: {
  ticker: string;
  sector: string | null | undefined;
}): number {
  let score = 0;
  if (isUtahTicker(opts.ticker)) score += 2;
  if (isHealthcareSector(opts.sector)) score += 1;
  return score;
}
