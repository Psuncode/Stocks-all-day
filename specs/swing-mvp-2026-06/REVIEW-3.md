# Code review — Pass 3 (post-v2.1)

Reviewed: 2026-05-19
Reviewer: gsd-code-reviewer (read-only, third pass)

## Summary

The KV-backed layer (Feature E digest archive + Feature F quick-watch) lands cleanly. The Redis client is failure-soft, every call site degrades to "no archive" / "no watch" when env vars are missing, and the cron's try/catch around `persistDigest` correctly prevents archive outages from blocking Slack delivery. Pass 2's open items are closed: CR-01's symmetric `Math.min` is shipped, `/api/symbol` and `/api/evaluate` now thread `sectorRsByName`, and the synthetic-candidate dead code in `provider.ts` was either dropped or reframed (H1.5 from pass 2 — not re-verified here, see scope). However, three new defects deserve attention before this is stable: a same-day digest snapshot will silently overwrite a prior cron run (no merge, no audit trail), the `POST /api/watch` toggle has a read-then-write TOCTOU window that can drop one of two concurrent clicks, and `QuickWatchCard` ships obviously-dead arithmetic that screams "unfinished feature." Beyond those, the new UI surfaces are sound; mobile layout under 4-tab BottomNav and 14-chip Scanner strip survives a 320px viewport, just barely.

Counts: **0 Critical · 3 High · 6 Medium · 5 Low · 3 Info**

---

## High-severity findings

### H1 — `lib/digest/archive.ts:65` — Same-day digest snapshot silently overwrites prior cron — High

`persistDigest` calls `kv.set(snapshotKey(date), archived)` with no read-or-set guard. The key is `digest:${date}` and `date` is `todayYmd()` from the cron route. Two scenarios where this corrupts history:

1. A manual `POST /api/check-invalidations` at 14:00 UTC builds picks from cached intra-day data; the 21:05 UTC scheduled cron then overwrites with the closing snapshot. The earlier picks are gone — there's no merge, no audit trail, no warning.
2. A scheduled cron retries (Vercel retries on 5xx) and rebuilds the digest with slightly different data (cache eviction between attempts → re-fetched candles). Second attempt wins; first is lost.

The `/digest` page loads "what was persisted last," so backtesting over the archive is silently using whichever run wrote last that day, not the canonical EOD run. Worse: forward returns computed at read time are anchored to `pickClose` from whichever overwrite landed.

Fix options, in order of correctness:
- Add a `NX` guard via `kv.set(key, value, { nx: true })` so only the first run persists — requires manual override pathway.
- Tag each snapshot with the cron source (`scheduled` vs `manual`) and only let `scheduled` overwrite.
- Use a sorted-set / list per day so all runs are captured, with the latest scheduled run flagged as canonical.

The minimum acceptable behavior is to `console.warn` when overwriting an existing key so a human notices.

### H2 — `app/api/watch/route.ts:67-90` — Toggle is not idempotent under concurrent clicks (TOCTOU) — High

```ts
const currentSet = await listTickerSet();
if (currentSet.has(ticker)) {
  const result = await removeQuickWatch(ticker);
  return Response.json({ action: "removed", ... });
}
const result = await addQuickWatch({ ticker, ... });
return Response.json({ action: "added", ... });
```

Read-then-write. If two browser tabs (or two rapid taps before the optimistic state propagates) hit POST simultaneously while the ticker is **not** in the set:
- Both see `currentSet.has(ticker) === false`
- Both call `addQuickWatch`
- First writes the entry; second **overwrites with newer `added_at`** (because `addQuickWatch` constructs `added_at: entry.added_at ?? new Date().toISOString()`).
- Both return `{ action: "added" }`.
- The optimistic UI in `scanner-client.tsx:332-377` flips, then flips again — but `watched` ends up `true` in both, and the user sees "Watching" twice. Visually fine, semantically the toggle was meant to remove on second click.

The symmetric case is worse: ticker **is** in set, two concurrent removes. Both see `has(ticker) === true`, both call `removeQuickWatch`. `kv.del` and `kv.srem` are idempotent so no error — but neither client expected a `removed` response when the user only clicked once.

Either:
- Use `SADD ticker → returns 1 if added, 0 if existed` to make the toggle atomic; equivalent for `SREM`. Upstash supports both return values.
- Guard with a Redis transaction (`MULTI / WATCH`) — overkill for single-user.
- Accept the limitation and document — but rename the route action to `set` (always add) and `clear` (always remove) so the client decides intent.

The scanner UI's `watchInflight` set guards against the local double-click, but doesn't help with multi-tab. Single-user personal tool, low real-world risk, but the comment in `route.ts:9-10` ("If you ever expose this app to multiple users") understates the issue — even one user with two browser windows trips this.

### H3 — `app/watchlist/page.tsx:226-228` — Dead arithmetic in `QuickWatchCard` (`delta = ((lastPrice - 0) / 1) * 0`) — High

```ts
const delta =
  lastPrice == null ? null : ((lastPrice - 0) / 1) * 0; // placeholder; we don't have add-price
void delta;
```

This is unambiguous dead code that should never have left a working tree:
- `(lastPrice - 0) / 1) * 0` evaluates to `0` for every non-null `lastPrice`.
- The result is assigned to `delta`, then `void`-ed.
- The comment confirms intent (track price delta since add) but no `price_at_add` field exists on `QuickWatchEntry`. So the feature is unbuildable as-is without a schema change.

Severity is High because (a) it indicates an unfinished feature shipped to a personal-production endpoint, (b) if anyone later removes the `void delta;` and uses the variable they'll get silent zeros, and (c) the surrounding `QuickWatchCard` would be the place to wire `price_at_add` so the deception isn't obvious to future-you reading the diff.

Fix:
- Add `price_at_add: number` to `QuickWatchEntry` (in `lib/watch/quick-watch.ts:18-25`), populate from `r.metrics.price` at toggle time (need to pass it through `/api/watch` POST body — `scanner-client.tsx:353-359` and `watch-button-client.tsx:63-67`), then compute `delta = ((lastPrice - entry.price_at_add) / entry.price_at_add) * 100` and render alongside the "added X days ago" line.
- Or delete the placeholder until the feature is implemented.

---

## Medium-severity findings

### M1 — `lib/engine/evaluate.ts:774-780` — `todayYmd()` uses local time, archive key uses UTC — Medium

```ts
export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();           // LOCAL
  const m = String(d.getMonth() + 1).padStart(2, "0");
  ...
}
```

The function reads `d.getFullYear()` / `getMonth()` / `getDate()` — local-time fields. Meanwhile `lib/digest/archive.ts:140-143` (`addDays`) constructs dates via `${isoDate}T00:00:00Z` and `setUTCDate` — UTC-based.

On Vercel the process timezone is UTC by default, so today both functions agree. But:
- Any developer running locally in non-UTC (`TZ=America/Denver`) gets a key like `digest:2026-05-18` from `todayYmd()` while the cron at `21:05 UTC` saves `digest:2026-05-19`. Read-time forward-return calculations then compute against the wrong reference date.
- If Vercel ever changes the default TZ, or if a project-level `TZ` env var is set, behavior diverges silently.

Fix: rewrite `todayYmd` to use UTC accessors (`d.getUTCFullYear()`, etc.) so the archive key is timezone-independent. This is a one-method change with no semantic effect on prod today but closes the local-dev / UTC-drift hole.

### M2 — `lib/data/kv.ts:18-29` — Singleton race on first concurrent caller — Medium

```ts
let cached: Redis | null | undefined;
export function getKv(): Redis | null {
  if (cached !== undefined) return cached;
  ...
  cached = new Redis({ url, token });
  return cached;
}
```

Two concurrent first-time callers (e.g. cron's `persistDigest` and the page that loads `/digest` if a user happens to hit it during cron) both see `cached === undefined`, both construct a Redis client, both assign. JS being single-threaded saves us from a torn read — the second assignment cleanly replaces the first, and the first goes to GC.

Not a correctness bug (REST clients are stateless), but worth a note: in heavier setups you'd want a Promise-based memoization (`let cachedPromise: Promise<Redis> | null`). For this codebase's pattern (single-user, one cron, occasional page load) it's acceptable; document as intentional.

### M3 — `app/digest/page.tsx:57-64` — Cold `/digest` page makes N parallel `getCachedSymbol` calls — Medium

```ts
const enriched: EnrichedPick[] = await Promise.all(
  snap.picks.map(async (pick) => {
    const sym = await getCachedSymbol(pick.ticker).catch(() => null);
    ...
  }),
);
```

`enrichSnapshot` is called inside `await Promise.all(snapshots.map(enrichSnapshot))` (line 123), so the page fans out `DAYS_TO_SHOW (14) × picks_per_day (5) = ~70` `getCachedSymbol` calls in parallel on a cold cache. Same shape as the original H3 finding on `/watchlist` that was solved with `pMapLimit`. With `unstable_cache` mostly hitting on warm calls the real-world cost is small, but the cold-start case is exactly when this page will get hit (post-cron, fresh deploy).

Fix: reuse the `pMapLimit(5)` from `watchlist/page.tsx`. Same primitive, same concurrency bound. Also: many picks share tickers across days (the digest tends to be sticky), so a per-render `Map<string, Promise<UniverseSymbol|null>>` memoization would dedup the fan-out further.

### M4 — `app/digest/page.tsx:99-121` — `loadRecentSnapshots(14)` returns "last 14 dates," not "last 14 trading days" — Medium

`archive.ts:91-96` sorts dates and `.slice(-days)`. Over a 14-calendar-day window that includes 1-2 weekends, you'll get ~10 actual snapshots (cron is Mon-Fri only). The page advertises "Last {N} day{s}" using `snapshots.length`, which is honest, but the conceptual mismatch leaks into the user's mental model: "14 days" sounds like 2 weeks of trading history, when really it's 2 weeks of calendar history and ~14 trading days (3 weeks).

If the intent was "last 14 trading days," `loadRecentSnapshots` should not have a calendar-day filter — it should just take the last `N` index entries. The current implementation does effectively that (sort + slice by string), so behavior is fine, but the variable `DAYS_TO_SHOW = 14` is mislabeled. Rename to `SNAPSHOTS_TO_SHOW` or document.

### M5 — `app/symbol/[ticker]/page.tsx:413` — `/scanner?search=...` link does nothing — Medium

```tsx
<Link href={`/scanner?search=${encodeURIComponent(result.ticker)}`}>scanner row</Link>
```

But `scanner-client.tsx:163` initializes `search` as `useState("")` — no `useSearchParams` reads the URL, no effect syncs it. Clicking the link from the "not on watchlist" panel lands on `/scanner` but the search field is empty. Cosmetic UX defect.

Fix: read `useSearchParams()?.get("search")` and seed `useState(initial ?? "")`. ~3 lines.

### M6 — `lib/digest/archive.ts:122-137` — `computeForwardReturns` uses `t >= target` first-match without weekday-awareness — Medium

```ts
function findCloseOnOrAfter(candles, target) {
  for (const c of candles) {
    if (c.t >= target) return c.c;
  }
  return null;
}
```

The logic is: find the first candle whose date is ≥ `pickDate + H days`. Daily candles only exist on trading days, so the loop correctly skips weekends/holidays. Good.

But the comment on line 110-113 says "the FIRST trading day's close on or after (pick_date + H calendar days)". For `H=1` and a Friday pick, target is Saturday; first candle ≥ Saturday is Monday — correct, 3 calendar days, 1 trading day. For `H=7` and a Tuesday pick, target is the following Tuesday; first candle ≥ that Tuesday is exactly that Tuesday — 7 calendar days, 5 trading days. The horizons end up being a mix of calendar and trading semantics depending on weekday parity.

This isn't a bug per se — it's a documented intent — but the table column header "1d / 3d / 7d / 30d" on the page reads as trading days to anyone with a trading background. Either:
- Switch to a true trading-day offset (count `H` candles forward from pick date).
- Document the horizon semantics on the page (subtitle: "calendar-day horizons, first close on or after").

---

## Low-severity findings

### L1 — `app/scanner/scanner-client.tsx:857-897` — `ScanProgress` interval keeps ticking after data lands — Low

```tsx
function ScanProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  ...
}
```

The interval cleanup is correct, and the component unmounts when `data` arrives (line 609 conditionally renders it via `{!error && !data && loading && <ScanProgress />}`). So on the success path no leak.

Failure path: if `setError` is called, `loading` is also set to `false` in the `finally` block. `loading=false` removes the gate that mounts ScanProgress. Good.

The remaining concern: if the user navigates away mid-scan, React unmounts and clears the interval. Fine.

No bug — but the `elapsed * 6` fill formula passes 100 at 17s while the friendly message at 30s says "Still working." If the page hits maxDuration (60s) the bar will be pegged at 95% for 43s. Cosmetic; consider a slowdown curve after `elapsed >= 17`.

### L2 — `app/symbol/[ticker]/watch-button-client.tsx:34-53` — `useEffect` does not guard the `setEnabled(false)` path against stale-closure when `ticker` changes — Low

```tsx
useEffect(() => {
  let cancelled = false;
  fetch("/api/watch")
    .then((r) => r.json())
    .then((json) => {
      if (cancelled) return;
      if (json.kv === false) { setEnabled(false); return; }
      const set = new Set((json.tickers ?? []).map((t) => t.toUpperCase()));
      setWatched(set.has(ticker.toUpperCase()));
    })
    .catch(() => { if (!cancelled) setEnabled(false); });
  return () => { cancelled = true; };
}, [ticker]);
```

If the user navigates from `/symbol/AAPL` to `/symbol/MSFT` while the AAPL fetch is in flight, the AAPL effect's `cancelled` is set, and the MSFT effect fires a fresh fetch — correct. The `kv === false` branch is also guarded by `cancelled`. Fine.

However, `setEnabled(false)` is a one-way switch — once a user hits a temporary network error, the button is hidden until full reload. The catch branch never retries. Minor UX issue; a small "tap to retry" affordance would be friendlier.

### L3 — `lib/watch/quick-watch.ts:31` — `normalize()` regex strips lowercase but preserves `.` and `-` — Low

```ts
function normalize(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}
```

Correct for normal tickers (BRK.B, RDS-A). But: hyphen-minus in `[^A-Z0-9.\-]` doesn't need escaping at end of class, and a literal `-` mid-class is what the negation expects. ESLint may flag the unnecessary escape; otherwise harmless.

More substantively: an attacker controlling the request body could send `ticker: "A".repeat(10000)`. Normalize would return the full 10000-char string. The Redis key becomes `quickwatch:AAAA...` (still A-Z, so passes normalize), and `kv.set` accepts it. Upstash REST has a body-size limit (~1 MB) but a long key still consumes index space. Add a length cap (e.g. `if (ticker.length > 12) return ""`) — real tickers are ≤6 chars, 12 is generous.

### L4 — `app/watchlist/page.tsx:179-188` — Inner `pMapLimit` for quick-watch enrichment duplicates the outer one — Low

The `QuickWatchSection` defines its own enrichment loop using the same `pMapLimit` import. Two separate concurrency pools means a watchlist with 50 YAML entries + 30 quick-watch entries will run 5+5=10 concurrent Yahoo calls when both lists are cold. Today the symbol cache makes this trivial; in a future where the sets grow, share a single semaphore.

Minor; the current concurrency is well within Yahoo's limits.

### L5 — `lib/digest/archive.ts:72-76` — Trim deletes snapshots in parallel, then `srem` is a separate call — Low

```ts
if (sorted.length > KEEP_DAYS) {
  const stale = sorted.slice(0, sorted.length - KEEP_DAYS);
  await Promise.all(stale.map((d) => kv.del(snapshotKey(d))));
  await kv.srem(INDEX_KEY, ...stale);
}
```

Order is correct (delete blobs first, then drop from index). But if the parallel `kv.del` partially fails (network blip), `srem` still runs, leaving `digest:<date>` orphans in Redis indexed by no set. Future `loadRecentSnapshots` won't see them, but they consume storage forever.

Use `Promise.allSettled` and only `srem` the dates whose `del` succeeded. Or accept it as bounded leak (KEEP_DAYS=60 plus a small backlog).

---

## Informational

### I1 — Mobile layout at 320px viewport — survives, just barely

- **BottomNav (4 tabs):** Each `<li>` is `flex-1` inside `max-w-md`. At 320px the inner row is 320px wide, each tab gets 80px — large enough for the 22×22 icon + 11px label. Touch target is the full 56px (`h-14`) cell. Adequate per WCAG 2.5.5 (44×44 minimum) and Apple HIG (44×44). OK.

- **Scanner chip strip (`scanner-client.tsx:542-602`):** 6 setup chips + 1 divider + 3 toggle chips = 10 chips in `flex flex-wrap`, plus the search input and two action buttons above. At 320px these wrap to 5-6 rows. Tap targets are `py-2 px-3` ≈ 30px tall; below the 44px guideline. Not a regression from v1.10 — the chips were always this size — but the 14 you mentioned in the prompt includes ALL toggles and is the worst-case wrap. Acceptable for v1; flag if you ever bump font sizes.

- **Symbol-page hero (`page.tsx:174-209`):** At 320px the ticker block (`flex-col` on mobile via `md:flex-row`) stacks above the decision row. The decision row uses `flex flex-wrap items-center gap-2` with badge + reason text (`md:max-w-md`) + `SymbolWatchButton`. On a 320px viewport: badge is ~80px, reason text takes a full row, watch button (px-4 py-2 + tracking-[0.2em]) is ~120px. Layout wraps to 3 lines (badge | reason | button) — exactly what was intended. No bug; the heuristic in the comment ("4 lines became 3") holds.

### I2 — Failure-soft pattern holds end-to-end

The cron route's digest-archive try/catch (`check-invalidations/route.ts:122-135`) correctly wraps both the `persistDigest` call and any throw it could produce. Even if Upstash returns 500 or times out, the next line (`sendSlackDigest(...)`) executes. Verified the soft-fail at each layer:
1. `getKv()` returns `null` when env vars missing.
2. `persistDigest` returns `{ ok: false, reason }` on null KV or thrown error; never throws.
3. Cron route doesn't read `archiveResult.ok` for control flow — just logs.
4. Slack delivery is independent.

This is the right shape.

### I3 — Things deserving callout

The KV-backed layer is well-shaped overall: separate namespaces (`digest:*` vs `quickwatch:*`), per-feature modules with clear failure semantics, and a documented setup guide in `KV-SETUP.md` (not re-verified). The forward-return computation is fresh-at-read-time (no stale persisted returns to invalidate). Pattern is reusable for future KV-backed features (audit log, per-ticker notes, etc.).

---

## Things that are now genuinely solid

1. **The CR-01 fix landed correctly** — `evaluate.ts:108-117` is the symmetric `Math.min(closes.length, spyCloses.length, 60)` plus a clean `spyClose <= 0` filter that no longer pads with the most-recent close. The original H1 → CR-01 → final form took three passes but the final form is correct.

2. **Sector RS threading through every entry point** — `runScan`, `/api/scan`, `/api/evaluate`, `/api/symbol/[ticker]`, and `app/symbol/[ticker]/page.tsx` all build `sectorRsByName` once and pass it. The fallback path in `evaluate.ts:466-473` is preserved as a safety net but `sectorRsByName` is never `undefined` in production code paths. C1 is fully closed.

3. **Failure-soft pattern across all three external dependencies** — Yahoo (provider fallback tickers), Slack (`sendSlackDigest` swallows), and now KV (every persist/load returns `{ ok: false, reason }`). No external outage takes down the cron. This was an explicit ask in `requirements.md §D.6` / §E.5 and it's actually true now.

4. **The optimistic-revert pattern in `scanner-client.tsx:332-377` and `watch-button-client.tsx:57-74`** — Both correctly capture `wasWatched` before flipping, revert on non-OK or thrown response, and gate against double-fires via `watchInflight` (scanner) or `loading` (symbol page). Single-tab correctness is solid; cross-tab is the H2 gap.

---

## Recommended fix order

1. **H3** (delete or properly wire the dead `delta` arithmetic in `QuickWatchCard`) — 2 min if delete, 30 min if wire — this is the most embarrassing visible artifact.
2. **H1** (snapshot overwrite — at minimum `console.warn` when overwriting; ideally `NX` guard or source-tagging) — 15 min.
3. **H2** (use `SADD`/`SREM` return values to make the toggle atomic) — 20 min.
4. **M1** (switch `todayYmd` to UTC accessors) — 5 min — one-method change, prevents future TZ drift.
5. **M5** (wire `useSearchParams` in scanner to honor `?search=`) — 10 min.
6. **M3** (apply `pMapLimit(5)` to `/digest` page enrichment) — 10 min.
7. **L5** (`Promise.allSettled` on the trim path) — 5 min.

Total for items 1-7: ~1.5 hours. Items M2 / M4 / M6 / L1-L4 are nice-to-haves or documentation tweaks.

---

_Reviewed: 2026-05-19_
_Reviewer: gsd-code-reviewer (read-only, third pass)_
_Depth: deep — KV layer + new UI surfaces + regression cross-trace through v1.11 → v2.1_
