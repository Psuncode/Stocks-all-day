# Journal math verification

Reviewed: 2026-05-19
Reviewer: general-purpose (read-only verification)
Scope: `lib/journal/archive.ts` (`computeRForTrade`, `dollarPnL`, `computeStats`, `loadWeeklyStats`) against `lib/journal/schema.ts`.

## Summary

- Cases tested: 11
- Cases passing math verification: 11
- Issues found: 3 (1 doc bug, 1 fencepost/docstring drift, 1 minor timezone gotcha)
- No correctness defects in `computeRForTrade`, `dollarPnL`, or the core aggregation in `computeStats`.

The arithmetic is sound for every case I traced. The findings are around contract clarity (docstring lies about expectancy units) and edge-of-window semantics in `loadWeeklyStats`.

Verification method: source trace + hand-calc. No script was run — KV is not provisioned, and the pure functions were tractable to verify by inspection. Case 7 was verified against `data/watchlist.yaml` (ANGX confirmed present with `invalidation_price: 2.30`) but the YAML loader was not exercised live.

## Case-by-case results

### Case 1: empty input — PASS

Hand-calc: `trades=[]` → `n=0`, `closed=[]`, `closedN=0`, `openN=0`, `closedWithR=[]`, all branches use the `=== 0` guards → all metrics 0, `bySetup={}`.
Code (archive.ts:217-258) matches exactly. The `for (const t of trades)` setup loop runs zero times, leaving `bySetup={}` as required.

### Case 2: single open trade — PASS

Hand-calc:
- `n=1`, `closedN=0`, `openN=1`.
- `closedWithR=[]` → `winRate=0`, `avgR=0`, `expectancy=0`.
- `totalPnL=0` (no closed trades; reducer over empty array returns initial 0).
- `bySetup`: setup loop assigns `PULLBACK → {n:1}`. Second loop finds `setupClosed=[]` (length 0) and forces `winRate=0, avgR=0` via the explicit `if (setupClosed.length === 0)` branch (archive.ts:264-268).

Result matches expected.

### Case 3: closed winner (entry=10, stop=9, exit=12, shares=100) — PASS

`computeRForTrade` (archive.ts:172-190):
- `status === "closed"` ✓, `exit_price=12` ✓
- `stop = 9`, `direction = 1`, `risk = (10-9)*1 = 1`, `risk > 0`
- `R = (12-10)*1/1 = +2.0` ✓

`dollarPnL` (archive.ts:192-196): `(12-10)*1*100 = +200` ✓.

Aggregation: `closedWithRn=1`, `wins=1`, `winRate=1.0`, `avgR=2.0`, `totalPnL=200`, `rWins=[2]`, `rLosses=[]`, `avgWin=2`, `avgLoss=0`, `lossProb=0`, `expectancy = 1.0*2 + 0*0 = 2.0`. ✓

### Case 4: closed loser (entry=10, stop=9, exit=8.5) — PASS

- `risk=1`, `R=(8.5-10)/1 = -1.5`
- `dollarPnL = (8.5-10)*100 = -150`
- `winRate=0`, `avgR=-1.5`, `totalPnL=-150`, `rLosses=[-1.5]`, `avgLoss=-1.5`, `lossProb=1`, `expectancy = 0*0 + 1*(-1.5) = -1.5` ✓

### Case 5: closed, no stop, no thesis — PASS

`computeRForTrade`: `stop_price` undefined and `watchlist_thesis_ticker` undefined → `stop` stays null → `return null` (archive.ts:184).
`dollarPnL` is independent of stop, so $ P&L still aggregates into `totalPnL`. Confirmed: `totalPnL` reducer at archive.ts:236 uses `dollarPnL(t) ?? 0` and does not gate on R availability. ✓

### Case 6: degenerate stop (entry == stop) — PASS

`risk = (10-10)*1 = 0`. Guard `if (risk <= 0) return null` at archive.ts:188 fires. R is null → trade excluded from `closedWithR`, `avgR`, `winRate`, `expectancy`. `dollarPnL` still computes (and is counted in `totalPnL`). Behavior is correct.

### Case 7: thesis-linked R (ANGX, no explicit stop) — PASS (verified by trace; YAML confirmed)

Verified `data/watchlist.yaml` line 5 contains `ticker: ANGX` and line 16 contains `invalidation_price: 2.30`. The map is built once per `computeStats` call from `loadWatchlist()` (archive.ts:202-215) and keyed by `ticker.toUpperCase()`.

Trace with `{entry_price:2.67, exit_price:3.00, watchlist_thesis_ticker:"ANGX", shares:100}`:
- `t.stop_price` undefined → falls through to `t.watchlist_thesis_ticker` branch (archive.ts:178-183).
- `thesisInvalidationByTicker.get("ANGX") = 2.30` → `stop = 2.30`.
- `risk = (2.67 - 2.30) * 1 = 0.37`, `R = (3.00 - 2.67)/0.37 = 0.33/0.37 = 0.8918918...` ≈ +0.89 ✓.

Not executed live (no KV). The YAML loader path itself is wrapped in `try { ... } catch {}` and silently degrades to an empty map (archive.ts:204-215), which is the documented fall-back.

### Case 8: short trade (entry=50, stop=55, exit=45) — PASS

- `direction = -1`
- `risk = (50 - 55) * (-1) = +5`, `risk > 0` ✓
- `R = (45 - 50)*(-1)/5 = +5/5 = +1.0` ✓
- `dollarPnL = (45 - 50)*(-1)*100 = +500` ✓

Direction multiplier is applied in both numerator and denominator of R, and once in $ P&L. Sign conventions are correct for shorts.

### Case 9: mixed batch (3 wins +1/+2/+1.5, 2 losses -1/-0.5, 1 open, 1 closed-no-R) — PASS

- `n=7`, `openN=1`, `closedN=6`, `closedWithRn=5`
- `wins=3`, `winRate = 3/5 = 0.6`
- `avgR = (1+2+1.5-1-0.5)/5 = 3.0/5 = 0.6`
- `rWins=[1,2,1.5]`, `avgWin = 4.5/3 = 1.5`
- `rLosses=[-1,-0.5]`, `avgLoss = -1.5/2 = -0.75`
- `lossProb = 2/5 = 0.4`
- `expectancy = 0.6*1.5 + 0.4*(-0.75) = 0.9 - 0.3 = +0.6` ✓

**Sign convention is correct.** Because `rLosses` stores raw negative R values (archive.ts:240), `avgLoss` is negative, so `winRate*avgWin + lossProb*avgLoss` is algebraically equivalent to the conventional `pWin·avgWin − pLoss·|avgLoss|`. The code at archive.ts:248 reads as a sum but mathematically it's a difference. This is the right answer.

Note: a hypothetical R=0 trade (exit==entry) falls into `rLosses` because the filter is `r <= 0` (archive.ts:240). It contributes 0 to `avgLoss` numerator but counts toward `lossProb` denominator, slightly diluting the loss probability. Since the expectancy contribution is `0 * (anything) = 0`, the expectancy value is unaffected. `winRate` correctly excludes R=0 from wins (`r > 0` at archive.ts:227). Internally consistent — flagging only as a definitional curiosity, not a bug.

### Case 10: bySetup grouping (3 PULLBACK / 2 BASE_BREAKOUT / 1 undefined) — PASS

Setup loop (archive.ts:253-258) uses `key = t.setup_at_entry ?? "UNSET"`. The 1 undefined trade lands under "UNSET". The mutable `cur` ref is re-fetched from `bySetup[key]` each iteration, so increments accumulate.

Per-setup metrics (archive.ts:260-273) re-derive `winRate` and `avgR` by filtering `closedWithR` to the setup. Scoping is correct — open trades and closed-no-R trades count toward `n` but not toward per-setup `winRate`/`avgR`, which is the desired semantics.

### Case 11: loadWeeklyStats fencepost — PASS with caveat (see Issue 2)

Code (archive.ts:300-308):
```
const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
const recent = trades.filter(
  (t) => t.status === "closed" && (t.exit_date ?? "") >= cutoffDate,
);
```

Behavior with `days=7` on 2026-05-19 UTC:
- `cutoffDate = "2026-05-12"`.
- Filter is **inclusive** (`>=`), so a trade with `exit_date === "2026-05-12"` is **IN**.
- Effective window: 2026-05-12 through 2026-05-19 inclusive = **8 distinct dates**, not 7.

If the docstring intent is "the last 7 calendar days," strict reading would mean a 7-day rolling window. The current implementation is an inclusive 8-day window for `days=7`. For a Friday digest covering "this week," this is probably acceptable, but worth flagging — see Issue 2.

## Issues found

### Issue 1 — `DerivedStats.expectancy` docstring is wrong (severity: low, doc-only)

**File:** `lib/journal/schema.ts:128`
**Says:** `/** Sum of all winning $ P&L minus sum of all losing $ P&L. */`
**Actually:** Computed as `winRate * avgWin + lossProb * avgLoss` over R-multiples (archive.ts:248). Result is a unitless R-expectancy per trade, not a dollar sum.
**Impact:** Anyone reading the schema to understand the API will misinterpret the number — they might display it with a "$" prefix or sum it into a dollar P&L total. The Slack digest or UI strip could ship with the wrong unit label.
**Fix:** Replace docstring with something like: `/** R-expectancy per closed-with-R trade: winRate·avgWin + lossProb·avgLoss (unitless, in R). */`

### Issue 2 — `loadWeeklyStats` window is inclusive-of-cutoff (severity: low, fencepost)

**File:** `lib/journal/archive.ts:300-307`
**Says:** docstring at line 298-299: "Stats limited to trades closed within the last N calendar days."
**Actually:** With `days=7`, the window spans 8 distinct calendar dates because `>=` includes the cutoff date itself. A trade exited exactly 7 calendar days ago appears in the "weekly" stats.
**Impact:** Low. For a Friday digest the practical difference is one extra day of trades. But if someone later builds a "last 30 days" rolling chart and assumes the buckets don't overlap, they'd double-count boundary trades.
**Fix options:** (a) change to `>` for strict-N-days, or (b) tighten the docstring to "the last N+1 calendar days inclusive" or "closed on or after `today − N` UTC."

### Issue 3 — `cutoffDate` is computed in UTC; `exit_date` is user-supplied (severity: low, timezone)

**File:** `lib/journal/archive.ts:303`
**Says:** `new Date(cutoffMs).toISOString().slice(0,10)` produces a UTC date string.
**Concern:** The trade's `exit_date` is also a YYYY-MM-DD string, but the journal UI likely captures it in the user's local timezone. If the user is in a tz behind UTC (e.g., America/Los_Angeles, UTC-7/8) and the digest cron fires close to midnight UTC, the cutoff can be a day "ahead" of the user's mental model.
**Impact:** Very low. Affects at most one trade per digest, only for trades closed near the boundary, and only for non-UTC users. Worth a comment, not a refactor.
**Fix:** Either accept it and document, or pass an explicit `now` parameter that callers can localize.

## Recommendations

Priority order:

1. **Fix Issue 1 now (1-line doc change).** Wrong units in a published type is the kind of thing that bites silently. Either fix the docstring or rename the field to `rExpectancy`. Low effort, blocks misuse.
2. **Resolve Issue 2 in v4.1.** Pick a side: tighten the docstring or tighten the filter (`>` vs `>=`). Document the choice. The Friday digest is the only current caller, so impact is small, but lock the contract before more callers appear.
3. **Defer Issue 3.** Note it in a code comment near archive.ts:303. Don't refactor until a user complains or a multi-tz feature lands.
4. **Optional polish:** add a small unit-test file (`lib/journal/__tests__/archive.test.ts`) covering the 11 cases above. The pure functions are easy to test in isolation by stubbing `loadWatchlist`. This would prevent future regressions on the sign conventions, the short-side direction multiplier, and the R=0 edge.

## Caveats

- I did not execute the code. All findings come from source-tracing and hand-calculation.
- The YAML-load path in Case 7 was verified by inspection only. `loadWatchlist()` itself was not opened; if it throws on unrelated input, the silent `catch {}` would mean **all** R values fall back to "explicit stop only," reducing `closedWithRn`. Worth a smoke test before relying on thesis-linked R in production stats.
- The Zod schemas were not stress-tested. They appear to correctly enforce `exit_date` + `exit_price` on closed trades (schema.ts:56-76), so the defensive `?? 0` and `=== null` guards in `computeStats` should rarely fire in practice.
