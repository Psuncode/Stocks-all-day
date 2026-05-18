# Tasks — Swing MVP 2026-06

**Implements:** `design.md` (2026-05-18)
**Target ship:** 2026-06-17
**Format:** 7 atomic commits. Each is independently shippable — `npx tsc --noEmit` clean, `npm run dev` boots without errors, no broken states left behind. Build forward, don't accumulate WIP.

---

## Critical path

```
T1 ──► T2 ──► T5 ──► T6 ──► T7
       │
       ├──► T3
       └──► T4
```

Total work: ~9 hours. Critical path: T1→T2→T5→T6→T7 ≈ 6 hours. T3 + T4 are parallelizable with the cron track if you weekend-batch them.

**Suggested cadence:** 1 evening per task, 7 evenings → done. Targets a 2026-06-17 ship with ~3 weeks of buffer for life and bugs.

---

## T1 — Schema + loader

**Goal:** Define the YAML data model in zod, write a loader that parses, validates, and returns typed results. Zero UI impact.

**Files (new):**
- `swing-trader-demo/lib/thesis/schema.ts`
- `swing-trader-demo/lib/thesis/load.ts`
- `swing-trader-demo/data/watchlist.yaml` (one real ANGX entry from your 2026-05-18 thesis)
- `swing-trader-demo/data/.gitignore` (empty placeholder so the dir is committed)

**Files (modified):**
- `swing-trader-demo/package.json` — add `js-yaml`, `@types/js-yaml`, `zod`

**Acceptance:**
- [ ] `npm install` succeeds; lockfile updated
- [ ] `npx tsc --noEmit` clean
- [ ] `import { loadWatchlist } from "@/lib/thesis/load"` works
- [ ] Hand-test in a Node REPL or a throwaway page: load the YAML, log the parsed result, confirm `tickers[0].ticker === "ANGX"`
- [ ] **Validator catches violations:** manually corrupt the YAML (e.g. add `thesis_type: catalyst` + a `price_below` rule), confirm `errors` array reports the type-mismatch issue
- [ ] **Validator catches missing required fields:** set a ticker to `status: dropped` without `dropped_at`, confirm the validator flags it

**Effort:** 1 evening (~75 min)
**Depends on:** nothing
**Out of scope:** UI, API, anything beyond loading + validating

**Commit message:**
```
thesis: add zod schema and YAML loader

Defines the watchlist data model (TickerEntry, Thesis, InvalidationRule)
with type-matching validation per requirements.md §B.5. Adds js-yaml + zod.

Loader returns parsed watchlist + non-fatal error list; invalid entries are
surfaced for UI display rather than crashing the app.

Seeds data/watchlist.yaml with one entry (ANGX) from the 2026-05-18 thesis.
```

---

## T2 — Rule evaluator + dedup

**Goal:** Pure functions that take a rule + candles and return `{ fired, suppressed, observed, threshold }`. Stateless 7-day dedup per design.md §6.

**Files (new):**
- `swing-trader-demo/lib/thesis/evaluate-rules.ts`
- `swing-trader-demo/lib/thesis/horizon.ts` (computed `time_horizon` → state)
- `swing-trader-demo/lib/thesis/sizing.ts` (`suggestedShares()` helper)

**Acceptance:**
- [ ] `evaluateRule(rule, candles)` returns the correct fire/suppress shape for each of the 5 supported signals
- [ ] `news_match` rule returns `{ fired: false, status: "pending_news_source" }` (v1 stub)
- [ ] Hand-test with synthetic candle arrays: write a small `lib/thesis/__sandbox__.ts` (gitignored or deleted before commit) that runs 5-6 cases and logs results. Confirm:
  - `price_below: 2.30` fires when last close = 2.25, suppresses if a prior 5-day close also ≤ 2.30
  - `rsi_above: 80` fires correctly with constructed up-trending closes
  - `volume_spike: 3` fires when last volume = 4×ADV60
- [ ] `horizonState("2026-06-01")` returns the right state given a configurable `today`
- [ ] `suggestedShares({ entry: 2.67, invalidation_price: 2.30, equity: 33000, risk_pct: 0.5 })` returns 446
- [ ] `npx tsc --noEmit` clean

**Effort:** 1 evening (~75 min)
**Depends on:** T1
**Out of scope:** Anything that touches React, the API, or live data fetch. These are pure functions only.

**Commit message:**
```
thesis: rule evaluator with stateless 7-day dedup

Pure evaluator over candle arrays. Suppression uses the prior-7-sessions
window in market data — no fires.json, no persistence layer. Also adds
horizon-state and ATR-suggested-shares helpers.
```

---

## T3 — Watchlist page rewrite (server component)

**Goal:** Convert `/watchlist` from localStorage-driven client to YAML-backed server component. Surface thesis + fires + horizon state per requirements.md §B.1.

**Files (modified):**
- `swing-trader-demo/app/watchlist/page.tsx` — become server component (was a thin wrapper)
- `swing-trader-demo/app/watchlist/watchlist-client.tsx` — accept initial data via props, drop localStorage edit UI, add thesis card section. Keep the migration banner logic (§9).

**Files (new):**
- Optional: `swing-trader-demo/app/watchlist/_thesis-card.tsx` if the JSX gets unwieldy

**Acceptance:**
- [ ] `/watchlist` renders the ANGX entry with its thesis, current price progress, horizon chip, and (if applicable) any fired rules with a red 🔥 banner
- [ ] Tickers with `status != active` render in a separate collapsed section
- [ ] Mobile card + desktop table both show the thesis section (build on the P3 responsive layout)
- [ ] Migration banner appears when `localStorage["swing.watchlist.v1"]` is present; dismiss removes it
- [ ] Empty state ("No tickers yet — add to data/watchlist.yaml") renders cleanly when `tickers: []`
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run dev` and visit `/watchlist` — works end-to-end

**Effort:** 1.5 evenings (~2 hours)
**Depends on:** T1, T2
**Out of scope:** Symbol page changes (T4), cron (T5), Slack (T6)

**Commit message:**
```
watchlist: YAML-backed server component with thesis + fire banners

Removes localStorage as source of truth; reads data/watchlist.yaml on every
page request. Renders thesis progress, horizon state, and any fired
invalidation rules. One-time migration banner offers a copyable YAML
snippet for legacy localStorage tickers.
```

---

## T4 — Symbol page thesis panel

**Goal:** When a symbol is in the watchlist with a thesis, render the thesis panel beneath the existing "Trade plan" card. Show stop vs invalidation, suggested shares, setup-tag mismatch warning.

**Files (modified):**
- `swing-trader-demo/app/symbol/[ticker]/page.tsx`

**Acceptance:**
- [ ] For a ticker WITH a thesis (e.g. ANGX): new "Thesis" card renders with all fields per design.md §8.3
- [ ] For a ticker WITHOUT a thesis: nothing new renders — page is unchanged
- [ ] `stop_price` (from engine) and `invalidation_price` (from YAML) appear as two distinct labeled rows
- [ ] Setup-tag-mismatch warning chip appears when `thesis.setup_tag !== gateSummary.setup` (both must be non-`none`)
- [ ] Suggested-shares hint computes via `suggestedShares()` from T2 — shows e.g. "Suggested: 446 shares · 0.5% risk · $33,000 acct"
- [ ] Confidence rendered as 1–5 dots (●●●○○)
- [ ] Horizon chip with "approaching" / "expired" tone if relevant
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run dev` and visit `/symbol/ANGX` — works

**Effort:** 1 evening (~75 min)
**Depends on:** T1, T2
**Out of scope:** Watchlist page (T3), cron (T5), Slack (T6). Can run in parallel with T3.

**Commit message:**
```
symbol: thesis panel with stop-vs-invalidation distinction

Adds a Thesis card to /symbol/[ticker] when a YAML thesis exists. Displays
stop (engine, risk) and invalidation_price (user, thesis death) as separate
labeled rows. Suggested-shares hint uses ATR-based fixed-fractional sizing
(no Kelly). Setup-tag mismatch surfaces user's tag vs engine-detected setup.
```

---

## T5 — Cron endpoint (no Slack yet)

**Goal:** `POST /api/check-invalidations` that authenticates against `CRON_SECRET`, evaluates rules across active tickers, and returns a JSON summary. No Slack delivery yet — that's T6.

**Files (new):**
- `swing-trader-demo/app/api/check-invalidations/route.ts`

**Acceptance:**
- [ ] `POST /api/check-invalidations` without auth header returns 401
- [ ] `POST /api/check-invalidations` with `Authorization: Bearer <CRON_SECRET>` returns 200 + JSON: `{ checked, fires, schema_errors, timestamp }`
- [ ] Fires array contains one entry per fired-and-not-suppressed rule with `{ ticker, rule_id, observed, threshold }`
- [ ] If YAML has schema errors, they appear in the response — endpoint does not crash
- [ ] If a ticker's candles unavailable, that ticker is skipped (logged), other tickers continue
- [ ] Manual test: temporarily set ANGX `price_below: 999` in YAML, call endpoint → confirm a fire in the response. Reset YAML after.
- [ ] `npx tsc --noEmit` clean

**Effort:** 1 evening (~75 min)
**Depends on:** T1, T2
**Out of scope:** Slack POST (T6), Vercel deploy (T7). Can run in parallel with T3 + T4.

**Commit message:**
```
api: add /api/check-invalidations cron endpoint

Reads watchlist, evaluates invalidation rules across active tickers,
returns JSON summary of fires. CRON_SECRET-gated. No notification delivery
yet (next commit). Manual POST returns the same shape Vercel Cron will hit.
```

---

## T6 — Slack delivery

**Goal:** When `/api/check-invalidations` finds fires, POST a single Block Kit message to `SLACK_WEBHOOK_URL`. Per requirements.md C.2.2 — one message per cron run, not N.

**Files (new):**
- `swing-trader-demo/lib/thesis/slack.ts`

**Files (modified):**
- `swing-trader-demo/app/api/check-invalidations/route.ts` — call `sendSlackDigest(fires)` after evaluation

**Acceptance:**
- [ ] Create a Slack workspace if you don't have one for personal use; create an app with Incoming Webhooks enabled; install to a DM-to-self channel; copy webhook URL into `.env.local` as `SLACK_WEBHOOK_URL`
- [ ] Add `NEXT_PUBLIC_APP_URL=http://localhost:3000` to `.env.local`
- [ ] With `SLACK_WEBHOOK_URL` set, calling `/api/check-invalidations` with a forced fire produces a Slack message visible in your DM
- [ ] Message has header (`🔥 N invalidations fired`), one section block per fire with bolded ticker (linked to `/symbol/TICKER`), description, observed, threshold
- [ ] With no fires, NO Slack message is sent (alert-only mode)
- [ ] If `SLACK_WEBHOOK_URL` is missing, endpoint logs a warning and returns the JSON summary without crashing — useful for local dev
- [ ] On Slack POST failure, error logged but cron tick still returns success
- [ ] `.env.example` updated with the two new vars

**Effort:** 1 evening (~75 min, mostly Slack app setup)
**Depends on:** T5

**Commit message:**
```
slack: deliver invalidation digest via Block Kit webhook

One POST per cron run with all fires bulleted. Skips delivery if no fires.
Hand-rolled JSON payload, no Slack SDK. SLACK_WEBHOOK_URL optional — missing
env var logs a warning rather than crashing, simplifying local dev.
```

---

## T7 — Vercel Cron config + production deploy

**Goal:** Schedule `/api/check-invalidations` to run daily at 16:05 ET (Mon-Fri). First successful production run logged.

**Files (new):**
- `swing-trader-demo/vercel.json`

**Files (modified):**
- `swing-trader-demo/.env.example`

**Acceptance:**
- [ ] `vercel.json` declares the cron at `5 21 * * 1-5` (21:05 UTC ≈ 16:05 EST)
- [ ] All env vars set in Vercel project settings: `WATCHLIST_PATH` (optional), `SLACK_WEBHOOK_URL`, `CRON_SECRET`, `ACCOUNT_EQUITY_USD`, `NEXT_PUBLIC_APP_URL` (set to your deployed URL), `GEMINI_API_KEY` (pre-existing)
- [ ] Production deploy succeeds; `/watchlist` works on the live URL
- [ ] **First scheduled run logged in Vercel Cron history** (wait until next 21:05 UTC weekday — if you can't wait, manually trigger via Vercel dashboard "Run now" button)
- [ ] First scheduled run produces either a Slack message (if anything fired) or a clean log line (if nothing fired)
- [ ] Push a deliberate-fire test (temporarily edit YAML, commit, push, wait for next cron) to confirm the full loop works in prod
- [ ] After test: revert the deliberate-fire commit

**Effort:** 1 evening (~75 min including waiting for or manually triggering the first cron)
**Depends on:** T6
**Out of scope:** anything new — this is deploy + verify

**Commit message:**
```
deploy: schedule daily invalidation check via Vercel Cron

Mon-Fri at 21:05 UTC (~16:05 ET, accepting DST drift). Calls
/api/check-invalidations with CRON_SECRET-gated auth. Completes the MVP.
```

---

## Done-when

The MVP is shipped when:

1. ✅ All seven commits on `main` and deployed to production
2. ✅ `data/watchlist.yaml` contains your real active theses (at least ANGX)
3. ✅ At least one scheduled cron run has logged in Vercel
4. ✅ At least one deliberate-fire test has produced a Slack message during a real cron run
5. ✅ Pre-existing demo features (scanner, settings, login) still work — no regressions
6. ✅ The OWLT-equivalent muscle is exercised: when a thesis dies, you edit YAML to `status: dropped` + `dropped_at` + `dropped_reason`, push, and the watchlist reflects it on next load

After (1)-(6), close the laptop. Freeze through 2026-08-17. The tool runs without you.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Yahoo Finance API breaks during freeze | Low | Pre-existing engine handles failures gracefully; cron returns JSON with skipped tickers; no Slack message ≠ broken tool |
| Slack webhook URL leaks (e.g. accidental git push) | Medium | `.env.local` gitignored; webhook in Vercel env only. Slack lets you rotate webhooks instantly |
| Vercel free tier limits hit during freeze | Very low | 5 weekday-only crons = 100/month, well under all caps |
| You add an "improvement" during the freeze that breaks production | High if undisciplined | **Hard rule: don't touch this repo between 2026-06-17 and 2026-08-17** unless prod is broken |
| Cron timing wrong on DST flip | Low | Accepted v1 imprecision; market close ± 1 hr is fine for end-of-day digest |
| YAML edit error makes the whole watchlist invalid | Medium | Loader returns `errors[]`, watchlist page shows them inline rather than crashing; you fix in vault, push, recover |

---

## Out of scope (do not start before 2026-08-17)

- Multiple watchlist YAML files / portfolios
- Trade-history journal beyond the `history` rows already in schema
- News fetch / `news_match` real evaluator
- Mobile app / PWA
- Authentication beyond existing demo-auth
- Sharing the data layer with the Python `/stock-analysis` skill
- AND/OR group logic for invalidation rules
- Setup detection retraining / backtest harness
- All the UI Phase 4/5 work (skeletons, code-split chart, dark mode, tokens)

If any of these feel urgent during the freeze — write them down in a `post-aug17-ideas.md` and close the laptop.

---

## Implementation order — concrete

If you sit down tonight (2026-05-18) and want a single suggested order:

| Evening | Tasks |
|---|---|
| **#1** (2026-05-19) | T1 — Schema + loader |
| **#2** | T2 — Rule evaluator |
| **#3** | T3 — Watchlist page rewrite |
| **#4** | T4 — Symbol page thesis panel |
| **#5** | T5 — Cron endpoint |
| **#6** | T6 — Slack delivery |
| **#7** | T7 — Vercel cron + deploy |
| **buffer** | ~3 weeks slack for bugs, vault data entry, life |

Done by 2026-05-26 if you ship one a night. Even at half pace — one every other night — done by 2026-06-09 with 8 days of buffer.

---

## End of tasks
