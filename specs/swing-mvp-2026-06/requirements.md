# Swing MVP — Pre-Inara Ship (2026-06-17)

**Author:** Philip Sun
**Created:** 2026-05-18
**Target ship:** 2026-06-17 (30 days)
**Freeze window:** 2026-06-17 → 2026-08-17 (Inara in-office sprint — no further dev)
**Format:** EARS (Easy Approach to Requirements Syntax)

---

## 0. Mental model

This MVP encodes a personal **OODA loop** for swing trading:

| OODA stage | How the tool supports it |
|---|---|
| **Observe** | Daily candle fetch + technical gates (`evaluate.ts`); invalidation-rule evaluation against current price/RSI/volume |
| **Orient** | Thesis block per ticker (entry/exit targets, time horizon, catalysts) — turns ambiguous "I like this stock" into a falsifiable bet |
| **Decide** | `PASS / WATCH / TRADE` from the engine + thesis status (`progress / horizon-approaching / horizon-expired / invalidated`) |
| **Act** | Manual — the tool does not execute trades. Slack ping closes the loop when an invalidation fires off-screen |

The point isn't real-time signals. It's making the user's existing reasoning **legible to a daily check** so theses don't quietly rot during the Inara sprint.

## 1. Problem statement

The current Swing Decision Engine has two structural problems for actual daily use:

1. **Two-database problem.** The watchlist lives in browser `localStorage` (`STORAGE_KEY = "swing.watchlist.v1"`). Real thesis work — ticker-level analysis, catalyst dates, drop reasons — already lives in the Obsidian vault as narrative markdown (e.g. `School/3.知识文件/Finance & Investing/2025-10-02 Stocks.md`). Double-entry guarantees drift; on mobile, only the vault is available.
2. **No thesis encoding.** The engine outputs `PASS / WATCH / TRADE` based on technical gates, but doesn't know *why* the user holds a position or *what would invalidate it*. The valuable rule from today's ANGX work — "another equity offering announcement = thesis killed" — has nowhere to live. The user must remember to check it manually.

This MVP closes both gaps before Inara starts, so the tool runs passively during the 9-week freeze.

## 2. Out of scope (deferred to post-2026-08-17)

- User accounts / authentication (beyond the existing demo-auth)
- Social features, sharing, comments
- Decision journal / trade-history analytics ("Six months of personal data → patterns") — this is the long-term edge but isn't shippable in 30 days
- Sharing a data layer with the Python `/stock-analysis` skill (rules-file factor-out) — valuable but not load-bearing
- Dark mode, design tokens, perf polish, list virtualization (UI Phase 4/5 from earlier audit)
- News fetch / NLP for `news_match` invalidation rules — captured in schema for forward compatibility but evaluator is a stub
- **Email notifications.** Considered (Resend). Dropped 2026-05-18 in favor of Slack incoming webhook — user already has Slack open during work hours and the webhook setup is simpler (no DKIM, no domain, no transactional-email provider).

## 3. Glossary

- **Vault** — the user's Obsidian vault at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/School/`
- **Watchlist YAML** — a single file at a configurable path inside the vault, source-of-truth for tickers under consideration
- **Thesis** — a structured statement of *what the user expects to happen and by when*
- **Invalidation rule** — a typed predicate that, when true, indicates the thesis has been broken and the user should be alerted
- **Active ticker** — a watchlist entry whose `status` is `active`
- **Fire** — an invalidation rule whose predicate is currently true

---

## 4. Feature A — Watchlist sync from vault YAML

### A.1 File source

- **A.1.1** *(Ubiquitous)* The system shall read the watchlist from a YAML file committed to this repository at `swing-trader-demo/data/watchlist.yaml`.
- **A.1.2** *(Ubiquitous)* The user maintains the file in their Obsidian vault and syncs it into the repo via a manual `git` push when ready to deploy. The vault is the source of truth for *editing*; the repo file is the source of truth for *the running app*.
- **A.1.3** *(Ubiquitous)* The system shall treat the YAML file as **read-only at runtime**. It shall never write to, rename, or delete the file.
- **A.1.4** *(Event-driven)* When the user opens `/watchlist`, the system shall re-read the YAML file from disk (no in-process caching beyond the request lifetime).

### A.2 Schema

- **A.2.1** *(Ubiquitous)* The YAML file shall conform to the schema defined in `specs/swing-mvp-2026-06/watchlist.schema.yaml` (a separate file, written alongside this spec). The top-level shape is:

  ```yaml
  version: 1                     # required
  risk_pct: 0.5                  # optional, default 0.5 — used for suggested-shares hint
  tickers:                       # required, list (may be empty)
    - ticker: ANGX               # required, normalized [A-Z0-9.-]
      name: Angel Studios        # optional
      status: active             # required: active|research_pending|shelved|dropped|exited
      sector_tag: media          # optional
      thesis:                    # optional
        summary: "string"
        thesis_type: catalyst    # required: catalyst|technical|mixed — gates invalidation type matching
        setup_tag: oversold_bounce  # optional: pullback|base_breakout|squeeze|oversold_bounce|none
        confidence: 3            # optional, 1–5 (Farnam Street calibration)
        entry_target: 2.67       # numeric
        exit_target: 5.00        # numeric, user-set sell-on-success target (Howard Marks Q1)
        invalidation_price: 2.30 # numeric, "if it gets here I was wrong" — distinct from engine stop_price
        time_horizon: 2026-08-31 # ISO date
        catalysts: ["string", ...]
      invalidation_rules:        # optional, list of typed rules (see B.2). Always OR-of-list.
        - id: equity_offering
          signal: news_match
          pattern: "(equity offering|secondary offering|share issuance)"
      sizing:                    # optional
        position_pct: 5          # % of account
        notes: "string"
      history:                   # optional, list of prior round-trips
        - date: 2025-Q4
          result: "won $2.50→$3.10"
          setup_tag: pullback    # recommended — enables strategy-level P&L analysis
          spy_trend_on_exit: up  # recommended
      obsidian_link: "[[wikilink]]"
      notes: "free-form"
      dropped_at: 2026-05-18     # required iff status=dropped|exited
      dropped_reason: "string"   # required iff status=dropped|exited
  ```
- **A.2.2** *(Ubiquitous)* The schema shall reject any ticker entry where `thesis.thesis_type` and the `invalidation_rules[].signal` types do not match the **type-matching table** (B.5). This enforces the 0xkyle / Spectra Markets rule: invalidations must be of the same type as the thesis.
- **A.2.3** *(Ubiquitous)* `invalidation_rules` shall be evaluated as a logical OR — any single fired rule invalidates the thesis. v1 does not support AND-groups or nested logic.

### A.3 Parsing & validation

- **A.3.1** *(Event-driven)* When the YAML file is read, the system shall validate it against the schema before evaluating any thesis.
- **A.3.2** *(Unwanted)* If the YAML file is missing, the system shall render an empty watchlist with an in-UI hint telling the user the expected file path.
- **A.3.3** *(Unwanted)* If the YAML file is malformed (invalid YAML syntax), the system shall display a single error banner with the line/column of the parse error and shall not crash.
- **A.3.4** *(Unwanted)* If a ticker entry fails schema validation, the system shall skip that entry, log a warning, and continue processing the remaining entries.
- **A.3.5** *(Ubiquitous)* The system shall normalize each `ticker` to uppercase and strip non-alphanumeric characters except `.` and `-`.

### A.4 Migration from localStorage

- **A.4.1** *(Event-driven)* When `/watchlist` loads for the first time after this MVP ships, if `localStorage["swing.watchlist.v1"]` exists, the system shall display a one-time banner showing the legacy tickers and a copyable YAML snippet the user can paste into the vault file.
- **A.4.2** *(Event-driven)* After the user dismisses the migration banner, the system shall remove the localStorage key.

---

## 5. Feature B — Thesis tracking with invalidation signals

### B.1 Thesis display

- **B.1.1** *(Ubiquitous)* For each watchlist entry with a `thesis` block, the system shall display the thesis summary, entry/exit targets, **invalidation_price**, time horizon, catalysts, **setup_tag**, and **confidence** on the watchlist row (mobile card) and on the symbol detail page.
- **B.1.2** *(State-driven)* While the current price is between the entry target and exit target, the system shall show a progress indicator (e.g. "$3.40 of $2.67→$5.00, 18% to target").
- **B.1.3** *(State-driven)* While the time horizon is within 14 days, the system shall display a "horizon approaching" badge on the watchlist row. This state shall be **computed at evaluation time**, not stored — no persistence layer for thesis states beyond the YAML itself.
- **B.1.4** *(State-driven)* While the time horizon has passed, the system shall display a "horizon expired" badge and prompt the user to update the thesis.
- **B.1.5** *(State-driven)* While the engine-detected setup for the ticker disagrees with the user's `thesis.setup_tag`, the system shall display a "tag mismatch" warning chip showing both labels (e.g. *"You tagged: pullback · Engine sees: squeeze"*). The disagreement itself is signal.
- **B.1.6** *(Ubiquitous)* The symbol detail page shall display `stop_price` (from engine, ATR-derived) and `invalidation_price` (from YAML) as **two distinct rows** with one-line descriptions: stop = "where I cut risk" / invalidation = "where I was wrong."

### B.2 Invalidation rule types (v1)

The system shall support the following invalidation rule `signal` types. Each rule shall include an `id` (required, unique within a ticker) and a `description` (required, human-readable).

- **B.2.1** `price_below` — *fires when* the most recent daily close is ≤ `level`. Required fields: `level` (numeric).
- **B.2.2** `price_above` — *fires when* the most recent daily close is ≥ `level`. Required fields: `level` (numeric).
- **B.2.3** `rsi_above` — *fires when* RSI(period) on daily closes is ≥ `level`. Required fields: `period` (default 14), `level` (numeric, 0-100).
- **B.2.4** `rsi_below` — *fires when* RSI(period) on daily closes is ≤ `level`. Required fields: `period` (default 14), `level` (numeric, 0-100).
- **B.2.5** `volume_spike` — *fires when* the most recent daily volume ≥ `multiple` × 60-day average daily volume. Required fields: `multiple` (numeric, default 3).
- **B.2.6** `news_match` — **deferred evaluator (v2)**. Schema accepts the rule with required field `pattern` (regex string) but the v1 evaluator shall always return `not_fired` and shall mark the rule as `pending_news_source` in the UI. This preserves forward compatibility for when a news source is wired up post-freeze.

### B.5 Thesis-type / invalidation-type matching table

Enforces the 0xkyle rule (research.md Theme B): invalidations must be of the same type as the thesis. The schema validator (A.2.2) shall reject YAML that violates this table.

| `thesis.thesis_type` | Allowed `invalidation_rules[].signal` types | Rationale |
|---|---|---|
| `technical` | `price_below`, `price_above`, `rsi_above`, `rsi_below`, `volume_spike` | Price-action thesis → price-action invalidation |
| `catalyst` | `news_match` (+ deferred future signals `event_delay`, `event_miss`, `guidance_cut`) | Fundamental/event thesis → fundamental/event invalidation |
| `mixed` | Any of the above | Explicit opt-in to mixed signals — user has acknowledged the tradeoff |

If a user wants a price stop in a catalyst trade, they should set `thesis_type: mixed` and accept that a price-driven invalidation may fire on noise unrelated to the catalyst.

### B.3 Rule evaluation

- **B.3.1** *(Event-driven)* When the user opens `/watchlist`, the system shall evaluate every invalidation rule for every active ticker using the most recent available daily candle data.
- **B.3.2** *(Event-driven)* When a rule fires, the system shall record the fire timestamp, the rule `id`, and the observed value vs the threshold.
- **B.3.3** *(Ubiquitous)* The system shall display fired rules visually distinctly on the watchlist row: a red `🔥 INVALIDATED` badge, the list of fired rule descriptions, and the observed values.
- **B.3.4** *(Ubiquitous)* The system shall display un-fired rules in a collapsed "Watching N rules" affordance to avoid clutter.
- **B.3.5** *(Unwanted)* If candle data is unavailable for a ticker (provider returned no data), the system shall mark all rules as `evaluation_skipped` and shall NOT report rules as fired.

### B.4 Edge cases

- **B.4.1** *(Ubiquitous)* The system shall evaluate rules only for tickers with `status: active`. Other statuses shall not contribute to alerts.
- **B.4.2** *(Ubiquitous)* If a ticker has no `invalidation_rules` block, the system shall still display the thesis and price progress, but shall not emit any fire events.

### B.6 Position-sizing hint (Howard Marks Q3 / ATR-based)

- **B.6.1** *(Ubiquitous)* On the symbol detail page, for tickers with a thesis, the system shall display a "suggested shares" hint computed as:

  ```
  suggested_shares = floor((risk_pct × account_equity) / (entry - invalidation_price))
  ```

  Where `risk_pct` comes from the YAML top-level (default 0.5%) and `account_equity` is an env-configured constant (`ACCOUNT_EQUITY_USD`, default 33000 — matches the user's actual size as of 2026-05-18). This is a hint only, not a binding directive. No Kelly, no fractional-Kelly. Source: research.md Theme C consensus.

---

## 6. Feature C — Daily Slack DM when a signal fires

### C.1 Trigger

- **C.1.1** *(Ubiquitous)* The system shall provide a single API endpoint `POST /api/check-invalidations` that runs the full evaluation pass for every active ticker and returns the list of fires.
- **C.1.2** *(Ubiquitous)* The endpoint shall be invocable on a schedule via Vercel Cron, configured to run daily at 16:05 America/New_York (5 minutes after market close — fires evaluated against the day's official daily candle).
- **C.1.3** *(Ubiquitous)* The endpoint shall be invocable on-demand (manually) by a button in the watchlist UI labeled "Run check now."

### C.2 Notification delivery (Slack)

- **C.2.1** *(Ubiquitous)* The system shall send notifications via a Slack incoming webhook configured via env var `SLACK_WEBHOOK_URL`. The webhook posts to a single Slack channel/DM that the user controls (recommended: DM to self in personal Slack workspace, or a `#swing-alerts` channel).
- **C.2.2** *(Event-driven)* When the daily check completes, if one or more rules fired, the system shall POST **exactly one Slack message** per cron run containing all fires as a single Block Kit `blocks` payload bulleted by ticker (research.md TL;DR #5: alert overload is the #1 abandonment trigger). One webhook call per cron tick — never N calls.
- **C.2.3** *(Event-driven)* When the daily check completes, if no rules fired, the system shall NOT send a Slack message (alert-only mode, not daily digest — chosen to minimize noise during Inara sprint).
- **C.2.4** *(Ubiquitous)* The Slack message shall use Block Kit formatting and list each fired rule with: ticker (bold), rule description, observed value vs threshold, and a link to `/symbol/[TICKER]` on the deployed app.
- **C.2.5** *(Unwanted)* If Slack delivery fails (webhook error, network failure), the system shall log the error and shall NOT retry within the same cron tick (deferred to the next day's run). UI still shows fires on next visit.

### C.3 De-duplication

- **C.3.1** *(Ubiquitous)* The system shall persist fire events in a single-file JSON store at a path configured via `FIRE_STORE_PATH` (default: `swing-trader-demo/data/fires.json`, committed to repo so state persists across Vercel deploys), keyed by `{ticker}:{rule_id}`.
- **C.3.2** *(Event-driven)* When a rule fires, if the same `{ticker}:{rule_id}` fired within the prior 7 calendar days, the system shall suppress the Slack notification for that rule but shall still display it in the UI.
- **C.3.3** *(Ubiquitous)* The fire store shall persist `last_fired_at` and `last_observed_value` per rule.

> **Note on fire-store persistence on Vercel:** Vercel serverless filesystems are ephemeral. v1 keeps `fires.json` simple by **committing it to the repo and writing via a GitHub Action** triggered by the cron, OR by accepting that dedup resets on each deploy (acceptable risk — Inara freeze means deploys are rare). Final mechanism deferred to `design.md`.

---

## 7. Non-functional requirements

- **N.1** *(Ubiquitous)* The system shall complete a full invalidation check (parse YAML + fetch candles + evaluate rules) within 10 seconds for watchlists of up to 50 tickers.
- **N.2** *(Ubiquitous)* The system shall fail gracefully when the vault is offline (iCloud sync pending). A missing file is not a crash condition — see A.3.2.
- **N.3** *(Ubiquitous)* No new runtime dependencies beyond: `js-yaml` (YAML parsing) and one Slack-Block-Kit type-helper package (optional — payloads can be hand-rolled). No email provider, no Inngest, no Mongo (research.md Part 1 #2 cautionary tale).
- **N.4** *(Ubiquitous)* The system shall remain deployable to Vercel free tier (memory + execution-time constraints).

---

## 8. Acceptance criteria (definition of done)

The MVP ships when, with no further dev intervention:

1. The user can edit `watchlist.yaml` in Obsidian on desktop or mobile, and the `/watchlist` page reflects the changes on next page load — no localStorage, no in-app editor.
2. The user can author a thesis + invalidation rules for ANGX (the live thesis from `2026-05-18 ANGX vs PTRN — Trade Setup Analysis`) and see them rendered correctly with current price progress.
3. The user manually triggers `POST /api/check-invalidations` with an ANGX rule deliberately set to fire (e.g. `price_below: 999`), and receives a Slack DM via `SLACK_WEBHOOK_URL` within 60 seconds. *(Updated from the original email-based criterion when Feature C switched delivery channels — see §6.)*
4. The Vercel cron is configured and a successful daily run is logged at least once during the staging period.
5. The user dismisses the localStorage migration banner once and never sees it again.

---

## 9. Open questions — RESOLVED 2026-05-18

- **OQ.1** *Vault vs repo source path?* → **Repo.** `swing-trader-demo/data/watchlist.yaml`. User edits in vault, pushes to repo manually via git when ready to deploy.
- **OQ.2** *Vercel can't read iCloud — sync mechanism?* → **No sync needed.** User pushes the YAML file as a git commit. Single-user, single manual step, zero infra.
- **OQ.3** *Email provider?* → **Dropped.** Switched to Slack incoming webhook (see Feature C). Simpler setup, fits user's existing tools.
- **OQ.4** *Weekly digest?* → **Dropped.** v1 is alert-only. Revisit post-Aug 17 if cadence proves wrong.

---

## 10. v1.1 amendments — research-driven (2026-05-18)

Folded in from `research.md` after deep-research pass on 9 OSS comparables + 6 trader-domain themes. All amendments are schema additions or constraint tightenings — none change the MVP scope or shape.

| # | Amendment | Section | Source |
|---|---|---|---|
| 1 | Added `setup_tag` to thesis schema | A.2.1, B.1.1 | Theme A: top-rated journal field |
| 2 | Added `thesis_type` + type-matching table that validator enforces | A.2.1, A.2.2, B.5 | Theme B: 0xkyle / Spectra Markets |
| 3 | Split `stop_price` (engine, risk) from `invalidation_price` (YAML, thesis death) | A.2.1, B.1.6 | Theme B: IU.com.au |
| 4 | Added `confidence: 1–5` (Farnam Street calibration) | A.2.1 | Theme F |
| 5 | Added top-level `risk_pct` (default 0.5) + ATR-based suggested-shares hint | A.2.1, B.6 | Theme C: 7+ sources agree |
| 6 | Renamed `invalidation` → `invalidation_rules` for clarity | A.2.1, B.3, B.4 | Naming hygiene |
| 7 | Made OR-of-list semantics explicit (no AND-groups in v1) | A.2.3 | User decision 2026-05-18 |
| 8 | Setup-tag-mismatch UI warning when user's tag ≠ engine's detected setup | B.1.5 | User decision 2026-05-18 |
| 9 | Slack: exactly one message per cron run, bulleted | C.2.2 | Theme E: alert overload kills tools |
| 10 | Compute `horizon-approaching` at evaluation time, do not store | B.1.3 | Research TL;DR #4: state minimalism |
| 11 | History entries include `setup_tag` and `spy_trend_on_exit` for future analysis | A.2.1 | Theme A: cheap-now, expensive-to-backfill |

**Deferred to design.md (research questions that don't block requirements):**
- Farnam Street `alternatives_rejected` field — friction vs leverage
- Weekly "all-clear" digest in addition to fire-only daily message
- `dropped` history rows feeding a future post-mortem view
- AND/OR group semantics for invalidation_rules (revisit post-Aug 17)

## 10.5 v1.2 amendments — daily digest (2026-05-18, post-deploy)

After the MVP shipped on 2026-05-18, the user requested a daily Slack digest of 5 engine-recommended candidates (with reasons + charts) combined with the existing invalidation alerts. Scope:

### Feature D — Daily top-5 digest in Slack

- **D.1** *(Ubiquitous)* When the daily cron (Feature C trigger) runs, the system shall ALSO build a digest of up to 5 candidate tickers from the full screener universe.
- **D.2** *(Ubiquitous)* Candidate selection:
  - Run `evaluateSymbol()` over every ticker in `getProvider().getUniverse()`
  - Filter to `decision === "TRADE"` first; if fewer than 5 TRADE, fill with `decision === "WATCH"`
  - Sort: TRADE before WATCH, then by `plan.rr` descending, then by `metrics.advUsd` descending
  - Take top 5
- **D.3** *(Ubiquitous)* Slack delivery — ONE combined message per cron run:
  - If any invalidations fired: header "🔥 N invalidations fired" + per-fire sections (Feature C unchanged) + divider
  - Then: header "📊 Today's 5" + per-pick sections, each containing:
    - Bold ticker linked to `/symbol/[TICKER]`
    - Decision tag (TRADE/WATCH) + setup_tag label
    - Engine `reason` text
    - Entry/Stop/Target/R:R if `plan` present
    - Chart image (Feature D.5)
- **D.4** *(Event-driven)* When digest computation produces zero candidates, the digest section is omitted (no "no picks today" placeholder).
- **D.5** *(Ubiquitous)* Charts shall be rendered via `quickchart.io` URLs embedded in Slack `image` blocks. URL encodes a Chart.js config with the last 90 daily closes; entry/stop/target horizontal reference lines added when `plan` is present.
- **D.6** *(Unwanted)* If digest computation throws or times out, the system shall still send the invalidation section (if any) and log the digest error. Digest failure never blocks invalidation alerts.
- **D.7** *(Ubiquitous)* The cron route shall declare `export const maxDuration = 60` to use Vercel's hobby-tier max function duration (the full-universe scan exceeds the 10s default).

### Non-functional

- **N.5** Adds one external dependency on `quickchart.io` (third-party chart-image service). Public service, no API key. If unavailable, Slack message renders without inline charts (image blocks fail gracefully — link in section text still works).
- **N.6** No new runtime npm dependencies. Chart URL construction is plain string-building.

### Out of scope (post-Aug 17)

- User-tunable digest size (5 hard-coded for v1.2)
- Personalization filtering (e.g. "only show oversold_bounce setups") — captured as future enhancement
- Server-rendered chart PNG to replace quickchart.io
- Backtest of "did the digest's top 5 outperform"

## 10.6 v2.0 amendments — redefine + add (2026-05-19)

After v1.x stabilized, the user surveyed the surface and reported "beside scanner I find little value in other features." Two streams of work follow.

### Redefine

- **R.1** *(Done)* — `/login` route removed. Demo-auth backend was a stub, server-side redirect to `/login` from `/` already replaced by `/scanner` (GSD review L8 + v1.11). Eliminates `app/login/page.tsx`, `lib/demo-auth.ts`, `components/UserStatus.tsx`.

### Feature E — Daily digest archive with forward-return tracking

**Goal:** answer the question "is the engine actually any good?" by persisting every daily digest and computing 1/3/7/30-day forward returns alongside each archived pick.

- **E.1** *(Event-driven)* When the daily cron completes, the system shall persist the digest output as a single record keyed by date (`YYYY-MM-DD`). The record contains the 5 picks with their ticker, decision, setup, plan, sustainedHighVol flag, sector, and the closing price at the moment the cron ran.
- **E.2** *(Ubiquitous)* The system shall provide a `/digest` page that shows the last 14 days of archived digests, newest first, with per-pick forward-return computed at read time using current quote data.
- **E.3** *(Ubiquitous)* Forward returns shall be computed for each pick at 1-day, 3-day, 7-day, and 30-day horizons. Each return is `(currentClose / pickClose) - 1`. Returns for horizons that haven't elapsed yet shall display as `—`.
- **E.4** *(Ubiquitous)* The page shall display per-day aggregate stats: average forward return at each horizon, hit rate (fraction of picks positive at that horizon), best/worst pick.
- **E.5** *(Unwanted)* When the persistence backend is unavailable, `/digest` shall display an "archive temporarily unavailable" message and the cron shall still send the Slack message. Persistence failure must never block a digest delivery.

### Feature F — One-tap Watch button on scanner rows

**Goal:** remove the YAML-editing friction killing watchlist engagement. Adding a ticker should be one tap from the scanner.

- **F.1** *(Ubiquitous)* Every row in the scanner UI (both the desktop table and the mobile card) shall include a "👁 Watch" button.
- **F.2** *(Event-driven)* When the user clicks "Watch" on a ticker not currently in the quick-watch store, the system shall append a record to a quick-watch store containing: ticker, ticker_name, sector, added_at (ISO timestamp), engine_setup_at_add, engine_decision_at_add.
- **F.3** *(Event-driven)* When the user clicks "Watch" on a ticker already present, the system shall remove that record.
- **F.4** *(Ubiquitous)* The button shall visually indicate "already watched" state via a filled icon.
- **F.5** *(Ubiquitous)* The `/watchlist` page shall merge the YAML-defined entries (theses) with quick-watch entries (light watches). Quick-watch entries are displayed in a separate section labeled "Quick watch."
- **F.6** *(Ubiquitous)* Quick-watch entries are READ AND WRITE from a different store than the committed `data/watchlist.yaml` (which remains read-only at runtime).

### Persistence choice (E + F)

Both features need a small server-side keyed store: ~30KB/day for digest archives × 365 days = ~11MB after a year; quick-watch store is small (10s-100s of entries). Options:

| Option | Setup | Pros | Cons |
|---|---|---|---|
| Vercel KV (Upstash Redis under the hood) | One Vercel CLI step | Native SDK, hobby tier (30k cmd/mo, 256MB) | Tied to Vercel |
| GitHub API commit-back | Octokit npm + GITHUB_TOKEN env | No external service; data lives in repo | Adds noisy commits to history |
| Upstash Redis (direct) | Same as Vercel KV minus the Vercel wrapper | Portable | Slightly more env config |
| Vercel Blob | Built-in SDK | Object storage style | Requires paid plan for >500MB; overkill for JSON |

Decision deferred to user (see prompt). Recommended: **Vercel KV** — simplest setup, hobby-tier free, native.

### Out of scope (v2.0)

- Position tracker / P&L (brokerage integration or manual entry; user trades elsewhere)
- Backtesting harness (needs historical OHLC at scale)
- Real-time intraday alerts (wrong cadence for a swing tool)

## 11. Next steps

1. User reviews v1.1 (this doc) and flags anything wrong.
2. Write `design.md` covering: file layout, API routes, data flow, library choices, fire-store mechanism (committed JSON vs ephemeral), type-matching validator implementation, Slack Block Kit payload shape.
3. Write `tasks.md` breaking design into 5-7 atomic commits (vertical slices, each independently shippable).
4. Estimated effort: 1 evening (design.md) + 6-7 evenings (implementation). Total ≤ 8 evenings, fits in the 30-day window with margin.
