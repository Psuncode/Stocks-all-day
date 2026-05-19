# PLAN-v3.0 — Brainstorm response

**Source:** comprehensive brainstorm covering API integrations + UX + net-new features
**Created:** 2026-05-19
**Freeze window:** 2026-06-17 → 2026-08-17 (Inara in-office sprint)
**Status:** ready to scope; user picks which subset ships before freeze

---

## 0. Calibration — premises that need correcting

The brainstorm is partially built on stale information about the codebase. Calling these out so they don't drive scope:

| Brainstorm claim | Reality |
|---|---|
| "It uses mock market data today" | **False.** Live Yahoo Finance via `yahoo-finance2` since baseline. The "mock data" copy in old Settings was removed in v1.10. |
| "Replace mock data with Polygon / Alpha Vantage" | **Skip.** Yahoo is free, no key, already wired. Polygon free tier is 5 calls/min — worse than what we have. |
| "CapIQ-style fundamentals slot already designed into the UI" | **Stale.** CapIQ branding was removed in v1.10 (the symbol page now says "Overview / On the roadmap" for fundamentals). |
| "Filter panel is very sparse" | **Stale.** v1.x and v2.x added 6 setup chips, 3 toggle chips, decision dropdown, max-rows dropdown, allow-earnings, include-blocked, why-blocked, search. Could be richer but it's not sparse. |
| "Copy Tickers / Export CSV hidden off-screen" | **Verified live state needed** — these are in the summary bar, may be visible on desktop and tucked on mobile. |
| "Mobile-responsive layout missing" | **Already shipped.** P3 (responsive cards) + v1.5 (bottom nav, slim header, PWA) + v1.11 (scanner mobile reorder). |
| "Dark mode toggle" | **CSS vars exist; toggle not built.** Worth doing but lower priority than data-density items. |
| "Add browser notifications" | **Duplicative with Slack** — alert delivery is solved. |
| "Inline watchlist edit modal — YAML unusable for non-technical user" | **Design tension.** The YAML being source-of-truth is intentional (vault-edit on mobile, git history is the journal, no two-database problem per the original strategic feedback). The Watch button in v2.0-F covers the "I just want to track this" case. A modal that writes back to YAML conflicts with the editing model. |

---

## 1. Scope — what I'd actually ship before 2026-06-17

Six items, total estimated effort ~8 hours / 3 evenings. Each independently shippable, each visually high-density-information per pixel.

### T1 — Mini sparklines in scanner rows

**Why:** Highest visual density-per-pixel improvement. User can scan 50 rows and see momentum direction at a glance without clicking.

**What:** Inline SVG sparkline (50px × 20px) at the start of each scanner row, drawn from the last 30 daily closes that are already loaded in the universe. Green if last > first, red otherwise. No external chart service; pure SVG path.

**Files:**
- `components/Sparkline.tsx` (new) — pure SVG, no client JS needed
- `app/scanner/scanner-client.tsx` — add a column on desktop, embed in card on mobile

**Effort:** ~2 hours

### T2 — Sortable scanner columns

**Why:** Counts on chips help filter; sorting helps prioritize within a filter. User asks for "best first" — composite score is overkill; click a column to sort works.

**What:** Click `Trend / Vol / Liquidity / Setup / Decision` headers to toggle asc/desc sort. Default: TRADE > WATCH > PASS, then ADV$ desc (current behavior). Active sort column gets a `↑` / `↓` indicator.

**Files:**
- `app/scanner/scanner-client.tsx`

**Effort:** ~1 hour

### T3 — Sector heat map panel

**Why:** Tells the user *"which sectors are working today"* in 2 seconds. Drives over-concentration awareness.

**What:** Small panel above the scanner results showing a grid of all sectors in the universe (~11 of them), each colored by 5-day average return of its members. Click a sector → adds a sector filter to the scanner.

**Files:**
- `components/SectorHeatMap.tsx` (new) — server-side computed values, server-rendered grid
- `app/scanner/page.tsx` — render it above the client

**Effort:** ~2 hours

### T4 — FRED macro context strip

**Why:** The brainstorm got this right — the engine's setup classification is regime-dependent. Knowing whether VIX is 12 or 32, and whether the 10Y is climbing or falling, frames every decision the user makes.

**What:** Thin horizontal strip below the header (desktop) or in a collapsed panel (mobile) showing: VIX (last + 5d change), 10Y yield (last + 5d change), Fed funds rate (last). FRED API is free, no auth, simple HTTP. Server-cached for 1 hour.

**Files:**
- `lib/data/fred.ts` (new) — fetch + cache
- `components/MacroStrip.tsx` (new) — server component
- `app/layout.tsx` — add below the existing status strip

**Effort:** ~1.5 hours

### T5 — Earnings calendar overlay on watchlist

**Why:** Avoiding earnings is half the engine's value (EVENT gate). Surface that constraint visually on the watchlist so the user can't accidentally hold through earnings.

**What:** For each watchlist card, if a ticker has an earnings date within the next 30 days, show a chip with the date and a small calendar icon. If within 10 days, the chip turns amber (EVENT-gate "risk" zone). If past, hide. The data is already in `UniverseSymbol.earningsDate`.

**Files:**
- `app/watchlist/_thesis-card.tsx` — add the chip
- `app/watchlist/page.tsx` — pass `symbol.earningsDate` through to the card

**Effort:** ~1 hour

### T6 — Days-left progress bar on watchlist cards

**Why:** A date string is a number; a bar is a feeling. Time pressure on a thesis horizon becomes immediate.

**What:** For active thesis entries, render a horizontal bar from (added_at OR thesis creation OR earliest-known-date) to `time_horizon`. Filled portion = days elapsed. Color: emerald until 80% elapsed, amber 80-100%, red past 100%.

**Files:**
- `app/watchlist/_thesis-card.tsx`

**Effort:** ~30 min

---

## 2. Defer to post-Aug 17 (high value, high effort)

These are real features but they need design + persistence work that doesn't fit before freeze.

### Trade journal / P&L tracking

The decision-journal pattern from research.md Theme F. Real long-term edge ("when did you actually trade, and how did it go?"). Needs:
- A `trades.json` or KV-backed store separate from watchlist
- Entry form (or YAML schema for entries)
- P&L calculation against current price
- Win rate / expectancy stats

Estimated effort: 1-2 weekends. Won't ship before freeze.

### Backtesting mode

"Given a setup, replay scanner hits over the last N days and report hit rate." Huge for calibrating trust. Needs:
- Historical OHLC archive (engine already has 252 days per symbol)
- Replay loop that evaluates each day independently
- Result aggregation UI

Estimated effort: 1 weekend. Won't ship before freeze. Could be a great post-freeze project.

### Inline watchlist edit modal

Conflicts with the YAML-as-source-of-truth design choice (deliberate from v1.0). Reconsider only if the workflow proves friction-heavy in practice.

### Dark mode

Tokens exist in `globals.css`. Toggle component + per-color variant tuning is 1 evening. Defer because the user explicitly trades during daylight hours; trading-floor "dark mode at night" pattern isn't their use case.

---

## 3. Skip outright (low value, duplicative, or wrong fit)

| Item | Why skip |
|---|---|
| Replace Yahoo with Polygon.io | Polygon free tier is 5 calls/min — worse than Yahoo. No win. |
| Alpha Vantage for indicators | Already compute RSI / ATR / SMA / slope client-side from Yahoo candles. No new API needed. |
| Browser Notifications API | Slack webhook already delivers alerts. Adding browser push duplicates. |
| Reddit / WSB mention count | Signal-to-noise is terrible. Not worth the complexity. |
| Unusual Whales options-flow | The engine is technical-pattern-based; options flow is a different signal and not part of the thesis. |
| Groq as Gemini fallback | Two LLMs to maintain. Gemini is fine; if it's down, the explainer can wait. |
| Data provider selector in Settings | Yahoo works; no reason to expose a switch. |
| Browser-local Gemini API key field | Adds a localStorage-as-secret-store pattern — worse than env var. Server is the right place. |
| Shareable watchlist snapshot URL | Personal tool; no audience to share with. Lower priority than features the *user* will use. |
| Keyboard shortcuts | Nice-to-have. Defer to post-freeze along with dark mode. |
| SEC EDGAR 8-K/10-Q | We already have earnings dates from Yahoo. Adding filing dates is overlap; minimal new info. |
| OpenFIGI ticker → ISIN | No broker integration on roadmap. Premature. |

---

## 4. Already shipped (don't re-implement)

The brainstorm called out several items that are already done:

| Item | Where shipped |
|---|---|
| Mobile-responsive layout | P3 / v1.5 / v1.11 |
| Live-data indicator | v1.5 layout strip; copy reconciled in v1.10 / v2.1 |
| Slack alerts when watchlist hits invalidation | v1.x + Slack digest |
| Watch button (one-tap add to watchlist) | v2.0-F |
| Days-elapsed display on watchlist | Currently text-only — T6 extends to a bar |
| "Why blocked?" expandable | Drawer-based "Explain" already exists per row — T2 could enhance ordering |
| Gemini explainer | Shipped; v2.1 T4 disables the button when key unset |

---

## 5. Critical-path execution order (if all 6 ship)

```
T6 (progress bar, 30m)       ─┐
T5 (earnings chip, 1h)        ─┼─► one commit "v3.0a: watchlist density"
T1 (sparklines, 2h)           ─┘
T2 (sortable cols, 1h)         ─► one commit "v3.0b: scanner sortable + sparklines"
T3 (sector heat map, 2h)       ─► one commit "v3.0c: sector heat map"
T4 (FRED macro strip, 1.5h)    ─► one commit "v3.0d: macro context"
```

Three or four atomic commits. Total wall-clock ~7 hours, comfortably 2-3 evenings.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| FRED API rate limits (T4) | No documented hard cap on the free tier; cache 1 hour server-side regardless. |
| Sparkline (T1) performance with 322 rows | Pure SVG path, no client JS. 322 × 30 points = ~10k points total — trivial to render. |
| Sector heat map (T3) cold-start latency | Computed from existing universe data; no extra API calls. Free relative to the existing /scanner load. |
| Earnings dates wrong (T5) | H2 fix already shipped (v1.9); dates are correct now. Trust the data. |

---

## 7. Out-of-scope reaffirmed

- Polygon, Alpha Vantage, NewsAPI, Groq, Reddit, Unusual Whales, OpenFIGI, EDGAR.
- Dark mode, keyboard shortcuts, browser-local API key fields.
- Inline watchlist edit modal.
- Shareable URLs, sector-only views, "best first" composite score.

---

## 8. Next steps

1. User picks the subset to ship (all 6, or a slice).
2. Execute in 3-4 atomic commits per §5.
3. Each commit verified with `npx tsc --noEmit` + production smoke test.
4. After ship: trigger a fresh cron; visit /scanner, /watchlist, /digest; confirm new surfaces render.
