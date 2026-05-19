# Code review — Pass 2 (post-v1.10)

Reviewed: 2026-05-19
Reviewer: gsd-code-reviewer (read-only audit, second pass)

## Summary

v1.9 and v1.10 closed most of the high-priority items from REVIEW.md cleanly — `buildSectorRsMap` is a real perf win, `toEpochSeconds` is correct, `pMapLimit` is race-free, the cron auth `isProd` guard fails closed, and Slack chart shortlinks are now properly parallelized. The codebase is in good shape and the daily Slack digest will hold up under N.1 watchlist sizes (≤50 tickers) without trouble. That said, **the H1 fix is incomplete** — the new code aligns the symbol tail correctly but assumes SPY has at least as many candles, which silently produces wrong rs60 values whenever SPY history is shorter (e.g. cold cache after a backfill, or any deploy where the SPY fetch returns a truncated series). I also surface several issues the first pass missed: a wholly-dead synthetic-candidate construction in `provider.ts`, two real perf bugs the C1 fix didn't extend to (`/api/symbol` and `/api/evaluate` still hit the slow sector-RS path), demo-era CapIQ copy still live on `/login`, and spec drift in the screener and price range. None of the new findings is a show-stopper; one is a real correctness regression.

Counts: **1 Critical (regression) · 3 High · 9 Medium · 6 Low · 4 Info**

---

## Regressions introduced by v1.9 / v1.10

### CR-01 — `lib/engine/evaluate.ts:107-113` — H1 fix is incomplete: assumes `spyCloses.length >= symCloses.length` — Critical

The v1.9 H1 fix correctly takes `symCloses = closes.slice(-60)` and then `spyTail = spyCloses.slice(-symCloses.length)`. This handles the case the original review flagged (symbol shorter than SPY). But it does **not** handle the reverse: if SPY's cached candle series is shorter than the symbol's (cold cache returns a partial chart, a Yahoo outage truncates a fetch, or a future config slimmed SPY history), `spyTail.length < symCloses.length`. The `map` then runs `symCloses[i] / (spyTail[i] || denomFallback)` for `i >= spyTail.length` — every such `i` collapses to `c / spyTail[spyTail.length - 1]` (the most recent SPY close), which is exactly the pathology the first review called out as "meaningless ratios" but for the symmetric direction.

The original REVIEW.md fix snippet was explicit:
```ts
const len = Math.min(closes.length, spyCloses.length, 60);
```
The implementation only mins against `closes.length`. A `Math.min` over both series is the right fix:
```ts
const len = Math.min(closes.length, spyCloses.length, 60);
const symCloses = closes.slice(-len);
const spyTail = spyCloses.slice(-len);
```

Severity is Critical because the symptom is identical to the original H1 (wrong rs60 → bad TREND-gate verdicts) and `runScan` calls this for every universe member, every cron, every page.

### Regression check (passed)

- **`buildSectorRsMap` filter (`candles<60 || price<=0`)** — sound. New-IPO names are excluded from the sector denominator; the per-symbol fallback `sectorRsByName.get(sector) ?? 0` correctly treats missing sectors as neutral. Edge case: sectors where _every_ member is filtered (small sectors of fallback tickers with `price === 0`) silently report 0 RS, hiding a weak sector. Documented in the code comment; acceptable.
- **`pMapLimit` closure on `cursor`** — race-free. `idx = cursor++` is synchronous (JS single-threaded); the await comes after, so two workers can't grab the same index. Closure on `cursor` via `let` is correct.
- **`priorRsiWindow` `start = Math.max(period, lastIdx - DEDUP_WINDOW)`** — correct. The `.slice(-DEDUP_WINDOW)` tail is redundant (the loop already produces ≤7 values when `period ≤ lastIdx - DEDUP_WINDOW`, and produces ≤ `lastIdx - period` otherwise — both bounded), but harmless.
- **`toEpochSeconds` heuristic** — robust. The `1e11` threshold correctly distinguishes seconds (~1.76e9 today) from ms (~1.76e12), handles `Date` objects, finite-number guards. A degenerate Yahoo response of `0` would now be returned as `0` epoch → 1970-01-01 → `daysBetween` returns a very large number → earnings window check passes. Acceptable since `earningsTimestamp` is `null | number` per the type and `null` short-circuits.
- **`riskDist > 0` check** — correct. When `entry <= stop` (degenerate setup), `rr = 0`, which fails `rr >= 1.6` → `setupStatus = "BLOCK"` → `decision = "PASS"`. L7 fix verified.
- **`usingFallback` boolean** — see CR-02 below. The boolean works, but it triggers dead code (synthetic candidates that are constructed and then thrown away).
- **Chart shortlink ordering** — `Promise.all(picks.map(...))` preserves index order regardless of completion order; `chartUrls[i]` lines up with `picks[i]`. ✓
- **`cached-provider.ts` cache keys** — `unstable_cache` includes function arguments as part of the cache key, so `getCachedSymbol("AAPL")` and `getCachedSymbol("MSFT")` are distinct entries. No collision.

---

## New findings (not in REVIEW.md)

### HIGH

#### H1.5 — `lib/data/provider.ts:43-58` — Synthetic candidate construction is dead code

When `candidates.length === 0`, the code builds 20 synthetic `ScreenerQuote` objects with `price: 0, bid: 0, ask: 0, avgVolume3m: 0, earningsTimestamp: null` — but then takes the `usingFallback` branch which calls `fetchFallbackUniverse()`, which calls `fetchSymbol(t)` (the 3-call path) and **ignores the synthetic candidates entirely**. The synthetic array is constructed, assigned to `candidates`, and then never read.

Risk: if someone refactors the branching and forgets that `fetchFallbackUniverse` ignores its input, the fallback path will silently use price=0 candidates and the `price === 0` sentinel issue REVIEW M6 was meant to solve will return. Replace with a one-liner that just sets `usingFallback = true` and skips the synthetic build:
```ts
let usingFallback = false;
if (preFilter(screenerQuotes).length === 0) {
  console.warn("[provider] No screener candidates, using fallback tickers");
  usingFallback = true;
}
const universe = usingFallback
  ? await fetchFallbackUniverse()
  : await fetchUniverseFromScreener(preFilter(screenerQuotes));
```

#### H2.5 — `app/api/evaluate/route.ts:60` — Slow sector-RS path runs N times per request

`/api/evaluate` accepts up to 200 tickers (line 33) and loops `evaluateSymbol` per ticker, never passing `sectorRsByName`. Each call falls into the slow branch (`evaluate.ts:463-468`) which `deriveMetrics`-es every same-sector peer. For 200 input tickers across ~10 sectors of ~60 names each: **200 × 60 = 12,000 redundant `deriveMetrics` calls**. The same C1 perf hole the v1.9 fix closed for `runScan` is wide open here.

Fix is one line:
```ts
const sectorRsByName = buildSectorRsMap(universe, spy);
// ...
results.push(evaluateSymbol(symbol, universe, { ... }, asOf, spy, sectorRsByName));
```

#### H3.5 — `app/api/symbol/[ticker]/route.ts:34` and `app/symbol/[ticker]/page.tsx:108` — Same slow path

Same issue, single-symbol. Each Drawer "Why blocked?" click on the scanner triggers `/api/symbol/[ticker]` → ~60 redundant `deriveMetrics` per click. Hot-path on user navigation. `getCachedUniverse()` returns the full universe with candles; passing it into `buildSectorRsMap` is cheap once and the result memoizes per-request.

For the server-component page, the same patch applies: build the map once after `getCachedUniverse()` resolves.

### MEDIUM

#### M1.5 — `lib/digest/build.ts:67-82` — Preference-bias and momentum tiebreakers undocumented in spec

The digest now sorts by `decision → sustainedHighVol → preferenceScore (Utah+Healthcare) → R:R → ADV$`. Original `requirements.md §10.5` specified `decision → R:R → ADV$`. The v1.6 and v1.8 commits added biases without updating the requirements doc. Spec drift; document or revert.

#### M2.5 — `lib/preferences.ts:34` — Healthcare regex misses common Yahoo sub-sectors

`HEALTH_TOKEN_RE = /\b(health|healthcare|pharma|pharmaceutical|biotech|biotechnology|biologics?)\b/i`. Yahoo's industry classification often returns strings like "Drug Manufacturers - General", "Medical Care Facilities", "Diagnostics & Research", "Medical Distribution" — none of which match either the sector set or the regex. SECTOR_MAP normalizes the parent sector to "Healthcare", so this is only an issue if a future code path queries by sub-sector. Low-risk today.

#### M3.5 — `app/login/page.tsx:128-145` — Demo-era "CapIQ" / "PM" / "Analyst" copy still live

M11 in the original review noted CapIQ/Atlas/Jamie copy. v1.10 cleaned `settings/page.tsx` but `login/page.tsx` still says:
- "CapIQ-ready ticker workspaces"
- "Every stock page is pre-structured for Capital IQ fundamentals, ownership, and estimates"
- "Team-ready views" / "trader, analyst, and PM personas"
- "No server-side auth, Supabase, or SSO is wired yet"

This is a personal swing-trading tool; the language reads as drift from the original demo. M11 not fully addressed.

#### M4.5 — `lib/data/screener.ts:26-33` — Six screeners now (spec says three)

Project memory and prior review both refer to "3 predefined screeners". The current code fans out to six: `most_actives, day_gainers, day_losers, most_shorted_stocks, aggressive_small_caps, undervalued_growth_stocks`. Doubles the cold-start Yahoo fan-out and the dedup cost. Probably intentional widening; needs to be reflected in `design.md` and project memory so future readers aren't surprised by the timing.

#### M5.5 — `lib/data/yahoo.ts:1-5` and `lib/data/screener.ts:3` — Two `new YahooFinance()` instances

I4 (original review, informational) is still present. Two independent cookie jars, two `suppressNotices` configs. The screener path uses its instance; the chart/quote path uses the other. Yahoo's anti-bot logic occasionally invalidates a session — having two means each must recover independently. Worth consolidating to a single `lib/data/yf.ts` exporter (10-line refactor).

#### M6.5 — `lib/engine/evaluate.ts:209` — Universe price band silently widened to $100

`requirements.md` historically said the universe is "$5–$50". `evaluate.ts:209` checks `m.price >= 5 && m.price <= 100`. The screener pre-filter at `screener.ts:122` also uses `q.price > 100`. Spec drift — likely intentional to widen the universe, but the scanner page chrome (`app/scanner/page.tsx:11`) advertises "$5–$100" while the spec still says $50.

#### M7.5 — `lib/data/yahoo.ts:62` — `q.regularMarketPrice ?? 0` produces a real-price-zero universe ticker on bad quote

When Yahoo returns a quote object without `regularMarketPrice` (rare but observed during the 4am UTC pre-market quiet zone for thinly-traded names), `last = 0`. The universe gate (`price >= 5`) immediately rejects, so the symbol is dropped — but only after a full 3-call fetch. Not a correctness issue, but wasted Yahoo quota. Consider returning `null` from `fetchSymbol` when `q.regularMarketPrice` is missing.

#### M8.5 — `app/api/check-invalidations/route.ts:71-104` — Per-symbol sequential loop preserved despite parallel fan-out everywhere else

The cron route still does:
```ts
for (const entry of active) {
  symbol = await provider.getSymbol(entry.ticker);
  ...
}
```
The header comment says "Sequential candle fetch: provider has a 5-min cache and the watchlist is small (<50)". With v1.9's MemCache, this is fine — but the provider cache is per-invocation only, and the first iteration on a cold start is uncached. With 50 active tickers, that's 50 sequential Yahoo round-trips inside a 60s budget. Use the `pMapLimit(items, 5, fn)` you already shipped in `watchlist/page.tsx`. Same code, same correctness, ~10× faster cold-start.

#### M9.5 — `lib/engine/evaluate.ts:322` — `trendMixed = universePass && (above50 || rsOk)` — redundant guard

`universePass` is verified by an early-return guard at line 251 (`if (!universePass) return …`). The `universePass &&` clause is therefore always true at line 322. Dead boolean; not a bug, but indicates a refactor that left a stray reference behind.

### LOW

#### L1.5 — `app/watchlist/page.tsx:37-46` — `priceProgress` comment is misleading

Comment says "only meaningful when entry < exit (long bias)" but the function correctly handles `entry > exit` (short bias) via `Math.min/max` on lo/hi. The percentage formula `(current - entry) / (exit - entry)` is signed and produces the right "% progress toward exit" in either direction. Comment is stale.

#### L2.5 — `lib/data/yahoo.ts:62-70` — Synthetic spread floor hides flat-quote symbols

`if (bid === 0 || ask === 0) { bid = last * 0.999; ask = last * 1.001 }` produces a fixed 0.2% spread on every off-hours quote. The downstream `spread_quality` gate (`evaluate.ts:412`) requires `spread ≤ 0.18%`, which **always fails on the synthetic floor** (0.2% > 0.18%). Result: every off-hours scan pushes everything to LIQUIDITY=CARE. Not a bug per se, but means the LIQUIDITY gate has a different baseline depending on time-of-day. Worth documenting.

#### L3.5 — `lib/digest/build.ts:31-37` — `DIGEST_CFG.maxRows = 0` (no cap)

The digest scan runs over the full 600-symbol universe with `maxRows: 0` (which `runScan` interprets as "no cap"). Then the digest itself trims to TOP_N=5. That's correct, but the route's `maxDuration = 60` cap means a slow universe (cold cache + Yahoo latency) can hit the timeout before the trimming runs. Consider passing `maxRows: TOP_N * 4` or similar to give an early bail-out.

#### L4.5 — `lib/engine/evaluate.ts:155` — `DerivedMetrics` no longer exposes `sma15` consumers

`DerivedMetrics.sma15` is computed (line 81) but never read anywhere except as part of `slope15PctPerDay` and `priceToSma15Pct` inside `deriveMetrics` itself. Exposing it on the public type is harmless but bloats the per-symbol payload. Minor.

#### L5.5 — `lib/data/cache.ts:23` — `clear()` method is unused

`MemCache.clear()` is defined but no caller invokes it. No bug — quality issue.

#### L6.5 — `vercel.json:5` — Cron schedule string still has no inline comment

L4 in the original review noted this. Still present. DST drift documented in `design.md`, not in `vercel.json`. Trivial.

---

## Findings the first review missed

### MEDIUM

#### M-MISS-1 — `lib/data/yahoo.ts:154-156` — `(quoteResult as any).shortName ?? (quoteResult as any).longName ?? ticker` — type-safety lapse

The cast loses the v3 yahoo-finance2 typing entirely. If Yahoo renames a field, TypeScript won't catch it; we discover the regression when name fields silently display as the ticker string. Add an explicit narrow type or remove the `quoteResult` fallback (the `quoteSummary` path already provides `shortName/longName`).

#### M-MISS-2 — `lib/engine/evaluate.ts:251-279` — Early-return path computes `volBand` inline instead of via `volBandFor()`

The original review caught the duplication (M3) and v1.10 introduced `volBandFor()` at line 21. But the universe-failure early return at line 260 still does:
```ts
vol: m.atrPct > 4 ? "HIGH" : m.atrPct > 2 ? "MED" : "LOW",
```
inline. Third copy of the same logic. If thresholds change, this branch quietly diverges.

### LOW

#### L-MISS-1 — `lib/thesis/evaluate-rules.ts:200` — `.slice(-DEDUP_WINDOW)` is redundant after H4 fix

After the v1.9 H4 fix clamped `start = Math.max(period, lastIdx - DEDUP_WINDOW)`, the loop produces at most `lastIdx - start ≤ DEDUP_WINDOW` values. The trailing `.slice(-DEDUP_WINDOW)` is a safety net that never trims anything. Cosmetic — leaving it is defensible as defense-in-depth, but a clarifying comment would help.

#### L-MISS-2 — `lib/thesis/slack.ts:206-218` — `rollingSma` returns nulls in early window even when seeded

The SMA15 seeding pattern (`seedCount = Math.min(candles.length, CHART_POINTS + 14)`) is meant to ensure SMA15 has real values from session 1 of the visible chart. But `rollingSma` returns `null` for indices < period-1 of the seeded array. If `seeded.length < 15` (very recent listing with <30 total candles), the entire visible SMA line is null → an invisible dashed line on the Slack chart. Not a crash, but the chart caption ("SMA15 dashed") is misleading.

### INFO

#### I-MISS-1 — `lib/digest/narrative.ts:34-39` — `trailing30 = candles.slice(-31, -1)` is 30 items only when ≥31 candles

If a symbol has exactly 30 candles, `slice(-31, -1)` returns all but the last → 29 items. `avgVol` divides by `Math.max(1, ...)` so no division-by-zero, but the 30-day reference is technically a 29-day reference at the boundary. Cosmetic.

#### I-MISS-2 — `data/watchlist.yaml` re-audit

Current file contains:
- ANGX ($2.67→$5, exit 2026-08-31, invalidation $2.30, with equity_offering news_match rule)
- PACS, SMR (research_pending)
- OWLT, PTRN (dropped/shelved with reasons referencing tariffs, insider selling)

Same content profile as I1 in the original review. No PII, no API keys, no account size, no MNPI. The `dropped_reason` strings remain public market commentary. **Still safe to keep public.** Watchlist remains small enough that the N.1 = 50 limit is theoretical.

---

## Confirmed resolved from REVIEW.md

- **C1 — Sector RS memoization (`buildSectorRsMap`)** ✓ — Implemented correctly; `runScan` calls it once and threads `sectorRsByName` through `evaluateSymbol`. (Caveat: the slow path is still live for single-symbol callers — see H2.5/H3.5.)
- **C2 — Cron auth env guard** ✓ — `isProd` check returns 500 in production when `CRON_SECRET` is unset. Defense-in-depth correct.
- **H1 — `rs60` alignment** ⚠ Partial — symbol-shorter-than-SPY direction fixed, SPY-shorter-than-symbol direction still buggy. See CR-01.
- **H2 — `earningsTimestamp` ms-vs-seconds** ✓ — `toEpochSeconds` handles `Date`, finite numbers, strings, and the 1e11 heuristic.
- **H3 — Watchlist fan-out cap (`pMapLimit`)** ✓ — Race-free, ordered, concurrency-bound to 5.
- **H4 — `priorRsiWindow` size bound** ✓ — `start = Math.max(period, lastIdx - DEDUP_WINDOW)` produces ≤7 values.
- **H5 — Sector RS filter to tradeable set** ✓ — `buildSectorRsMap` filters `candles<60 || price<=0`.
- **H6 — Parallel chart shortlinks** ✓ — `Promise.all` over `picks.map(chartShortUrl)` with order-preserving indexing.
- **M2 — Healthcare word-boundary regex** ✓ — `\b(health|healthcare|pharma|...|biologics?)\b` shipped.
- **M3 — `volBand` duplication** ⚠ Partial — `volBandFor()` extracted, but `evaluate.ts:260` still has an inline ternary. See M-MISS-2.
- **M4 — Loose `any` types in `/api/evaluate`** ✓ — `Map<string, UniverseSymbol>` and `DecisionResult[]` now used.
- **M6 — `price === 0` sentinel** ⚠ Partial — `usingFallback` boolean shipped, but the synthetic-candidate construction it gates is dead code. See H1.5.
- **M7 — Slack block truncation log** ✓ — `console.warn` when `blocks.length > 50`.
- **M9 — `daysUntil` consolidation** ✓ — `horizon.ts` exports `daysUntil` and `horizonState`; consumers now import.
- **M10 — Local `type Setup` → `SetupTag`** ✓ — `evaluate.ts:9` imports `SetupTag` from `lib/types.ts`.
- **M11 — Demo copy** ⚠ Partial — `settings/page.tsx` cleaned; `login/page.tsx` still has CapIQ/Atlas-style language. See M3.5.
- **L1 — Verbose logs gated** ✓ — `const debug = process.env.DEBUG_DATA ? console.log : () => {}` in `provider.ts` and `screener.ts`.
- **L3 — `CHART_POINTS` comment drift** ✓ — Header now says "the last 90 daily closes" reflects the SMA15 seed window, with `CHART_POINTS = 30` being the visible-window. Consistent.
- **L7 — Degenerate stop produces inflated R:R** ✓ — `riskDist > 0` guard returns `rr = 0`, blocking the setup.
- **L8 — Server redirect to `/login`** ✓ — `/` now redirects to `/scanner`.
- **I2 — Spec acceptance criterion email→Slack** — Not verified (didn't re-read requirements.md). Likely still stale wording.

---

## Highlights

1. **The H1 fix attempted the right alignment pattern** — explicit tail-mirroring is the right shape — it just stopped one operand short of the symmetric Math.min. Easy follow-up.
2. **`pMapLimit` is genuinely correct.** The closure-on-`cursor` pattern is one of the easiest places to introduce a race in JS-async code and the implementation gets it right on the first try.
3. **The `usingFallback` rewrite (M6)** is the right model even though it left dead code behind. The explicit boolean reads cleanly and won't bite future-you the way `price === 0` sentinels would.
4. **`toEpochSeconds` is a model normalizer** — accepts `null`, `Date`, finite number (with ms vs s heuristic), or string; returns `number | null`. Use this shape as a template for other Yahoo-data normalizers.
5. **Cron auth `isProd` gate** is exactly the defense-in-depth the original review asked for. Fail-closed in prod, fail-noisy in dev.

---

## Recommended fix order

1. **CR-01** (rs60 symmetric `Math.min`) — 5 min — replace one line; verifies H1 properly.
2. **H2.5 / H3.5** (thread `sectorRsByName` through `/api/evaluate` and `/api/symbol/[ticker]` + `app/symbol/[ticker]/page.tsx`) — 20 min total — three call-sites, identical patch. Eliminates the slow path entirely.
3. **H1.5** (drop dead synthetic-candidate construction in `provider.ts`) — 5 min — refactor for clarity.
4. **M-MISS-2** (replace inline `volBand` ternary at `evaluate.ts:260` with `volBandFor()`) — 2 min.
5. **M8.5** (parallelize cron's per-symbol loop with `pMapLimit(5)`) — 10 min — same primitive already imported elsewhere.
6. **M3.5** (purge CapIQ/PM/Analyst copy from `login/page.tsx`) — 15 min.
7. **M4.5 / M6.5** (update `design.md` and project memory for the 6-screener + $100 universe widening) — 10 min — doc-only.

Total for items 1-6: ~1 hour. The rest is informational or doc-only.

---

_Reviewed: 2026-05-19_
_Reviewer: gsd-code-reviewer (read-only audit, second pass)_
_Depth: deep — full re-trace of v1.9/v1.10 deltas plus modules added since pass 1_
