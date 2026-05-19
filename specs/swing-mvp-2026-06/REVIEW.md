# Code review — Swing Workspace MVP (post-v1.6)

Reviewed: 2026-05-18
Reviewer: gsd-code-reviewer (read-only audit)

## Summary

The MVP is in shippable shape and the spec→design→code traceability is unusually tight for a personal project. The thesis/invalidation pipeline is clean, the stateless dedup design is genuinely elegant, and the zod discriminated unions catch the type-matching constraints exactly where the spec wanted them. However, two performance issues are real (sector-RS recomputation inside the symbol evaluator; an N-way uncached fan-out on `/watchlist`), one correctness bug exists in the rs60 calculation when symbol/SPY series lengths differ, the cron auth fallback opens a hole if `CRON_SECRET` is ever accidentally unset in prod, and a yahoo-finance2 timestamp coercion can silently produce wrong earnings dates. None of the findings is a show-stopper; the top 3 BLOCKERS are correctness/perf bugs that will start mattering as the watchlist grows, but the daily run as-is should keep working.

Counts: **2 Critical · 6 High · 11 Medium · 9 Low · 5 Info**

---

## Critical findings

### C1 — `evaluate.ts:390-393` — Sector RS recomputes `deriveMetrics` for every peer of every symbol (O(N²/sectors))

```ts
const sectorSyms = universe.filter((u) => u.meta.sector === symbol.meta.sector);
const sectorRs =
  sectorSyms.reduce((sum, s) => sum + deriveMetrics(s, spy).rs60, 0) /
  Math.max(1, sectorSyms.length);
```

`evaluateSymbol` runs once per universe member. The EVENT gate then re-derives metrics for every same-sector peer. For a 600-symbol universe with ~10 sectors, that's ~600 × 60 = **36,000 `deriveMetrics` calls** instead of 600. `deriveMetrics` does SMA20/50/200 over the full candle window plus a 60-element slope calc — non-trivial per call.

**Why it matters:** This is the most likely cause of the digest cron flirting with the 60s `maxDuration`. It also blows up cold-start latency on `/scanner` and any page that calls `runScan`.

**Fix:** Memoize per-ticker metrics before the per-symbol loop in `runScan`, then pass a precomputed `Map<string, DerivedMetrics>` into `evaluateSymbol` so the sector lookup is O(peers) instead of O(peers × derive cost). Even a `WeakMap<UniverseSymbol, DerivedMetrics>` defined in module scope and populated in `runScan` would close the gap.

### C2 — `check-invalidations/route.ts:44-52` — Auth fallback silently allows unsigned cron in dev, with no environment guard

```ts
if (secret && secret.length > 0) {
  if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
} else {
  console.warn("[check-invalidations] CRON_SECRET unset — allowing request (dev mode only)…");
}
```

The "dev mode only" comment is aspirational — the code has no `process.env.NODE_ENV` check, no `process.env.VERCEL_ENV` check. If you push a Vercel deploy and the `CRON_SECRET` env var is missing (typo, copy-paste error, env var removed during a rollback), the cron endpoint becomes a fully-anonymous POST that runs the full-universe scan and posts to Slack. Anyone who knows the URL can trigger a Slack message and burn yahoo quota.

**Why it matters:** The route does real work (Yahoo fetches, Slack POST). Without a defense-in-depth env check, a missing env var converts your private personal endpoint into an open trigger.

**Fix:**
```ts
const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
if (!secret) {
  if (isProd) return new Response("Misconfigured: CRON_SECRET required in production", { status: 503 });
  console.warn("[check-invalidations] CRON_SECRET unset — dev only");
} else if (auth !== `Bearer ${secret}`) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

## High-severity findings

### H1 — `evaluate.ts:97` — `rs60` ratio misaligns symbol and SPY closes when lengths differ

```ts
const sym60 = closes.slice(-n);                // up to last 60
const spy60 = spyCloses.slice(-n);              // up to last 60
const ratios = sym60.map((c, i) => c / (spy60[i] || spy60[spy60.length - 1]!));
```

When `sym60.length === 60` and `spy60.length === 60`, indices line up correctly (both are tail-slices). But if symbol has fewer than 60 candles (recent IPO, newly added watchlist ticker), `sym60.length < spy60.length`. The map then aligns `sym60[0]` (oldest of the 40 available days) with `spy60[0]` (60 days back on SPY), which is **the wrong date**. The slope on those ratios is meaningless and rs60 will drive false TREND-gate verdicts.

**Why it matters:** The TREND gate uses `rsOk = m.rs60 >= -0.5` to allow WATCH. Newly listed names will get a junk rs60 that's just as likely positive as negative. For a single-user tool that defaults TRADE → cautious, false positives matter more than false negatives.

**Fix:** Align by tail explicitly:
```ts
const len = Math.min(closes.length, spyCloses.length, 60);
const sym = closes.slice(-len);
const spy = spyCloses.slice(-len);
const ratios = sym.map((c, i) => c / (spy[i] || 1));
```

Bonus: `spy60[spy60.length - 1]` as a fallback divisor is also wrong — using the most recent SPY close to backfill old days produces meaningless ratios. Drop the fallback; if SPY data is missing, return `rs60 = 0`.

### H2 — `yahoo.ts:53` — `earningsTimestamp` likely treated as ms when Yahoo returns seconds (1000× off)

```ts
earningsTimestamp: raw.earningsTimestamp
  ? Math.floor(new Date(raw.earningsTimestamp).getTime() / 1000)
  : null,
```

`yahoo-finance2`'s screener output for `earningsTimestamp` is unix epoch **seconds** (number). `new Date(seconds)` interprets that as ms-since-epoch, so `new Date(1759795200)` → `1970-01-21`, not `2025-10-07`. Then `.getTime() / 1000` produces a small number, and downstream `epochToYmd(epoch * 1000)` produces a 1970 date.

Two paths to verify:
1. If yahoo-finance2 actually returns a `Date` object here, `new Date(dateObj)` is a no-op and we're fine.
2. If it returns a number, we have a 50+ year off-by-1000.

The screener and chart APIs have inconsistent shapes — `assetProfile` returns Date objects, but `screener.quotes[].earningsTimestamp` is documented as a number. Worth verifying with a `console.log` on one fetch.

**Why it matters:** Earnings-window gate (`±10 days`) silently fails for every screener-discovered ticker; symbol-detail path uses `quoteSummary.calendarEvents.earnings.earningsDate` which returns Date objects (different code path, probably fine). The screener path is the one that feeds the 600-symbol universe.

**Fix:** Inspect raw type defensively:
```ts
function toEpochSec(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  return null;
}
```

### H3 — `watchlist/page.tsx:48-106` — Uncapped parallel fan-out to Yahoo on cold-start

```ts
const enriched: EnrichedEntry[] = await Promise.all(
  watchlist.tickers.map(async (entry) => {
    let symbol = await getCachedSymbol(entry.ticker);
    …
  }),
);
```

`getCachedSymbol` is backed by `unstable_cache` (15-min TTL), so warm hits are fine. But on **cold start** (first request after deploy or after Vercel evicts the function), every ticker in the watchlist triggers a separate `provider.getSymbol()` → `fetchSymbol()` → 3 Yahoo calls (chart + quote + quoteSummary). For the current 5-ticker watchlist, that's 15 parallel Yahoo calls. For the requirements N.1 limit of 50 tickers, it's 150 parallel calls in a 10s budget — Yahoo will rate-limit before that finishes.

**Why it matters:** The first user visit after the daily cron will frequently be the cold-start case (8-hour gaps). Page load goes from snappy to multi-second TTFB or partial-failure.

**Fix:** Bottleneck the per-symbol concurrency with the same `pMap(items, fn, 8)` you already have in `yahoo.ts`. Or use `getCachedUniverse()` first and only fetch `getSymbol` for tickers not present in the universe.

### H4 — `evaluate-rules.ts:186-197` — `priorRsiWindow` start bound can include >7 sessions on short candle series

```ts
for (let i = Math.max(period, lastIdx - DEDUP_WINDOW); i < lastIdx; i++) {
```

When `lastIdx - DEDUP_WINDOW < period` (i.e. candle series is short — say 16 closes for a 14-period RSI), the loop starts at `period` and walks all the way to `lastIdx`, producing more than 7 values. The dedup window is meant to be exactly 7 sessions; this widens it. Not catastrophic — wider suppression means fewer fires — but it violates the design spec §6 ("look back 7 trading days").

**Fix:** Compute the start as `Math.max(period, lastIdx - DEDUP_WINDOW)` is wrong; should be `Math.max(period - 1, lastIdx - DEDUP_WINDOW)` paired with a `loop only runs when i >= period`. Or simpler: clamp the count.

### H5 — `evaluate.ts:392` (also see C1) — Sector RS uses **all** universe symbols, not the filtered tradeable set

The sector calc walks the raw `universe` parameter. If the universe contains BLOCKED entries (which it does when `cfg.includeBlocked` is true on the scanner), sector RS is dragged by symbols the user will never trade. Not a bug per the spec, but it makes the EVENT gate's "sector momentum" check inconsistent depending on `includeBlocked`.

**Fix:** Either always filter to the post-UNIVERSE-gate set inside `runScan` before passing into `evaluateSymbol`, or document explicitly that sector RS includes blocked names.

### H6 — `slack.ts:166` — `chartShortUrl` is awaited sequentially inside the per-pick loop, not parallel

```ts
for (let i = 0; i < picks.length; i++) {
  …
  const chart = await chartShortUrl(r.ticker, pick.candles, r.plan);
  if (chart) blocks.push({ type: "image", … });
}
```

The file-header comment (line 350) says "Build digest blocks in parallel (chart shortlinks fan out to quickchart)" — but the loop awaits each chart before starting the next. 5 picks × ~500ms per quickchart round-trip = ~2.5s of avoidable latency in the cron path that's already bumping `maxDuration = 60`.

**Fix:** Promise.all the chart fetches first, then assemble blocks:
```ts
const charts = await Promise.all(picks.map(p => chartShortUrl(p.result.ticker, p.candles, p.result.plan)));
```

---

## Medium-severity findings

### M1 — `cached-provider.ts:27-41` — Single tag `["symbols"]` for all per-ticker cache entries

`getCachedSymbol("AAPL")` and `getCachedSymbol("MSFT")` both live under tag `"symbols"`. To invalidate one stale ticker you must `revalidateTag("symbols")` which nukes the entire universe of cached symbols. No per-ticker bust path exists. Fine for now (15-min TTL is short enough), but worth noting when you eventually wire an "I just edited the YAML, refresh now" button.

### M2 — `preferences.ts:38` — Healthcare substring fallback is broad

```ts
return lower.includes("health") || lower.includes("pharma") || lower.includes("bio");
```

Real Yahoo `sector` values normalize to one of ~11 buckets (`yahoo.ts` `SECTOR_MAP`). "Healthcare" is canonical. The substring fallback is meant to catch sub-sector strings, but `"bio"` is a 3-letter substring that matches "Biotechnology" (intended) but also any future sector string containing `bio` — e.g. "Carbon biofuels" or "Industrial Biomanufacturing". Low real-world risk today; future-tax.

**Fix:** Tighten to word-boundary regex: `/(^|\s|&)(health|pharma|bio)/`.

### M3 — `evaluate.ts:660` and `evaluate.ts:287` — `volBand` logic duplicated

```ts
const volBand = m.atrPct > 4 ? "HIGH" : m.atrPct > 2 ? "MED" : "LOW";
```

Lives in both `evaluateSymbol` and `finalize`. If you tune thresholds (e.g. switch HIGH to 3.5%), you must edit two places. Extract to a `volBandFor(atrPct)` helper.

### M4 — `app/api/evaluate/route.ts:43-47` — Loose `any` types in result aggregation

```ts
const found = new Map<string, any>();
const results = [] as any[];
```

These shadow the strong typing the rest of the codebase enforces. `found` should be `Map<string, UniverseSymbol>`, `results` should be `DecisionResult[]`.

### M5 — `app/api/scan/route.ts:18,27` — Cast-then-validate ordering

```ts
decisionFilter: (url.searchParams.get("decision")?.toUpperCase() as any) ?? "ALL",
…
if (!['ALL','PASS','WATCH','TRADE'].includes(cfg.decisionFilter)) {
  cfg.decisionFilter = "ALL";
}
```

The validation works, but the value is mis-typed for 4 lines before the check. Inline the validation into the assignment, or extract a `parseDecision()` helper.

### M6 — `provider.ts:47` — `candidates[0].price === 0` is a fragile sentinel for "fallback mode"

```ts
const universe = candidates[0].price === 0
  ? await fetchFallbackUniverse()
  : await fetchUniverseFromScreener(candidates);
```

The fallback ticker objects are constructed with `price: 0` to signal "I'm a fallback marker". A real Yahoo screener could legitimately return a ticker with price 0 (delisted, halted). Use an explicit boolean instead:

```ts
let usingFallback = false;
if (candidates.length === 0) {
  usingFallback = true;
  candidates = FALLBACK_TICKERS.map(…);
}
const universe = usingFallback ? await fetchFallbackUniverse() : await fetchUniverseFromScreener(candidates);
```

### M7 — `slack.ts:354` — Silent block truncation at Slack's 50-block limit

```ts
const payload: SlackPayload = { blocks: blocks.slice(0, 50) };
```

Correct behavior (Slack rejects >50 blocks), but with no log. If you ever hit it (multiple fires + 5 picks + multiple sections), you'll lose visibility silently. Add a `console.warn` when `blocks.length > 50`.

### M8 — `digest/build.ts:39-58` — Digest re-fetches universe + spy that the cron route already loads

In `check-invalidations/route.ts`, the route already calls `provider.getSymbol()` per active ticker. Then `buildDigest()` calls `provider.getUniverse()` + `fetchSpyCandles()` independently. The provider's MemCache makes this cheap (5-min TTL across calls inside the same invocation), so this is more of a layering smell than a perf issue, but it duplicates the pre-fetch logic the spec called out.

### M9 — `watchlist/page.tsx:14-27 + symbol/page.tsx:32-46` — `daysUntil`/`daysFromToday` duplicated 3+ times

The same UTC-midnight delta math exists in `horizon.ts:23-33`, `watchlist/page.tsx:29-42`, and `symbol/[ticker]/page.tsx:32-46`. Hoist into `lib/thesis/horizon.ts` and import once.

### M10 — `evaluate.ts:476` — Local `type Setup` redeclares `SetupTag` from `lib/types.ts`

```ts
type Setup = "PULLBACK" | "BASE_BREAKOUT" | "SQUEEZE" | "OVERSOLD_BOUNCE" | "NONE";
```

Identical to the exported `SetupTag` in `lib/types.ts:75`. If a new setup is ever added, both must change in lockstep. Use the exported type.

### M11 — `app/login/page.tsx` and `app/settings/page.tsx` — Demo-era copy still references "CapIQ", "Atlas Fund", "Jamie Collins", "mock market data"

```ts
const [email, setEmail] = useState("jamie@atlasfund.com");
```

The `/settings` copy literally says "This demo uses mock market data" — but the app uses live Yahoo. For a personal tool deployed publicly, this is harmless cruft, but if you ever share the URL it reads as stale.

---

## Low-severity findings

### L1 — `lib/data/{provider,screener,yahoo}.ts` — Verbose `console.log` lines in hot paths

The provider/screener happily log "discovered N unique tickers", "pre-filter N → M", "added X/Y Utah tickers" on every cache miss. In Vercel logs this is noise; switch to `console.debug` (Next.js dev console only) or gate behind `process.env.DEBUG`.

### L2 — `evaluate-rules.ts:130-141` — `volume_spike` suppression re-computes ADV per session inside an inner loop

Not a hot path (only the 7 prior sessions per active rule), but each iteration walks 60 prior sessions for ADV. For the watchlist size, it's fine; flag only if N.1 budget tightens.

### L3 — `slack.ts:51-53` — `CHART_POINTS = 30` constant comment header says "the last 90 daily closes"

The file-level comment refers to "the last 90 daily closes" while the actual constant is 30. Doc/code drift.

### L4 — `vercel.json:5` — Cron schedule comment-free; DST drift is documented in design.md but not in the file

`"schedule": "5 21 * * 1-5"` runs 17:05 ET in summer. Spec acknowledges this; consider a `// 21:05 UTC = 17:05 EDT / 16:05 EST (acceptable v1 drift)` comment in a `vercel.jsonc` if you ever convert.

### L5 — `app/api/scan/route.ts:23` — `Math.max(10, raw)` floor on `maxRows` silently rejects 1-9

If a user passes `?maxRows=5`, they get 10 rows. No 400 response, no log. Either accept the input or reject explicitly.

### L6 — `app/api/gemini/route.ts:121` — Returns the full upstream JSON on empty-response failure

```ts
return Response.json({ error: "empty_response", raw: json }, { status: 502 });
```

`json` may contain prompt context echoes or safety-filter metadata. Probably fine for personal use; in a public deploy, scrub before returning.

### L7 — `evaluate.ts:519` — `Math.max(0.01, entry - stop)` floor produces inflated RR if entry == stop

When `entry === stop` (degenerate setup), `rr = (target - entry) / 0.01` → a huge R:R that passes the `rr >= 2` gate trivially. Should fail the setup instead.

### L8 — `app/page.tsx:3` — Server-side redirect to `/login` even when localStorage demo-auth exists

Server can't read localStorage, so every fresh tab redirects through `/login` first. For the rebuilt personal tool, consider redirecting to `/scanner` and letting `/login` be opt-in.

### L9 — `evaluate.ts:79` `slope15Raw / sma15` — protected, but slope itself can dominate at small denominators

For very low-priced stocks (sma15 ≈ $5), tiny absolute moves become large `slope15PctPerDay` values. Threshold `>= 0.3` is tuned for normal prices; verify the 3W metric isn't flagging pure noise on $5 names.

---

## Informational notes

### I1 — `data/watchlist.yaml` audit (publicly committed)

Reviewed the file. Contents:
- ANGX thesis ($2.67→$5, exit Aug 31, invalidation $2.30)
- PACS/SMR (research_pending, no thesis)
- OWLT/PTRN (dropped/shelved with reasons)

No PII, no API keys, no email addresses, no account balance. The `dropped_reason` strings mention general market context ("tariff", "insider selling", "guidance cut") — these are public market commentary, not material non-public info. **Safe to keep public.**

### I2 — Spec-claimed acceptance criterion #3 references email, not Slack

`requirements.md:220` says "receives an email at `NOTIFY_EMAIL` within 60 seconds." The spec was later updated to use Slack (Feature C, OQ.3), but this acceptance line was missed. Cosmetic; the implementation correctly uses Slack.

### I3 — `lib/data/cached-provider.ts` is well-commented but the cron path commentary lives elsewhere

The header explains why cron skips the cache, which is correct, but readers of `check-invalidations/route.ts` won't see that justification. Consider mirroring the comment.

### I4 — Two separate `new YahooFinance()` instances (`yahoo.ts:5`, `screener.ts:3`)

Constructed independently; each has its own internal cookie jar state. Not a bug, but consolidating into a single exported instance (e.g. `lib/data/yf.ts`) would reduce surface area.

### I5 — `evaluate.ts` `gateSummary.trend` returns `"COUNTER"` only when `bounceCandidate` is true

When trend is counter and bounce candidate is false, trend status is `BLOCK` and the function returns via `finalize()` with `trend: "MIXED"` — not "COUNTER". This is intentional (the only way to surface "COUNTER" is via the oversold-bounce path) but counter-intuitive when reading the type alone. Worth a one-line comment near the type definition.

---

## Highlights — things done well

1. **Stateless dedup via candle history (`design.md §6` + `evaluate-rules.ts`)** — Replacing a `fires.json` file with a pure function of market data is a genuinely elegant move. It survives deploys, doesn't need GitHub Actions, and the implementation matches the design exactly.

2. **Zod discriminated unions for invalidation rules + `superRefine` for the type-matching table.** The thesis/signal-type cross-check (`schema.ts:152-184`) catches the 0xkyle constraint at parse time, not runtime. Clean.

3. **Failure-mode documentation in `slack.ts:1-15`** — The file-header comment block (3 named failure modes, what each does) is the kind of thing future-you will be grateful for at 11pm on a Friday.

4. **Spec/code traceability.** Almost every non-trivial decision in the code cross-references a requirements.md section (e.g. `evaluate-rules.ts:13` references design.md §6; `schema.ts:161` references requirements.md §B.5). Rare in solo projects; preserve this convention.

---

## Recommended fix order

1. **C2** (cron auth env guard) — 10 min — protects prod from accidental misconfiguration.
2. **H2** (yahoo earningsTimestamp coercion) — 20 min — silently wrong earnings dates undermine the EVENT gate.
3. **H1** (rs60 length mismatch) — 15 min — single 4-line fix in `deriveMetrics`.
4. **C1** (sector RS memoization) — 1-2 hr — biggest perf win; affects every scan + cron run.
5. **H3** (watchlist cold-start fan-out) — 30 min — wrap `getCachedSymbol` calls with `pMap(8)` to bound concurrency.
6. **H6** (parallelize chart shortlinks in Slack) — 15 min — straight `Promise.all` refactor.
7. **H4** (priorRsiWindow window-size bound) — 15 min — clamp the loop count to 7.
8. **M3 + M9 + M10** (consolidate duplicated date/volBand/setup-tag types) — 30 min — one cleanup PR.

Total estimated effort for items 1-7: ~5 hours. Items 8+ are quality-of-life and can ride along.

---

_Reviewed: 2026-05-18_
_Reviewer: gsd-code-reviewer (read-only audit)_
_Depth: deep — full cross-module trace from spec → engine → API routes → UI_
