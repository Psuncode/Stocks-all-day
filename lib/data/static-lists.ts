/**
 * Pure static ticker lists. Imported by client code (preferences.ts) so this
 * file must NOT pull in any server-only deps. Specifically: do not import
 * yahoo-finance2 here, or the whole SDK gets bundled into the client.
 */

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
] as const;

/** Safety net if all Yahoo screeners fail. Used by lib/data/provider.ts. */
export const FALLBACK_TICKERS = [
  "PLTR", "RBLX", "SOFI", "HOOD", "SNAP", "PINS", "AFRM", "NU",
  "DKNG", "RIVN", "ROKU", "CLF", "AA", "X", "RIG", "DAL", "UAL",
  "NCLH", "HIMS", "DUOL",
] as const;
