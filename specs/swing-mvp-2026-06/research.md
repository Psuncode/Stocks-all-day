# Research — Comparable tools + domain practices

Generated: 2026-05-18
Context: pre-MVP research for `swing-trader-demo`, supporting `specs/swing-mvp-2026-06/requirements.md`. Scope = (a) vault-driven YAML watchlist, (b) thesis + invalidation rules, (c) Slack webhook on Vercel cron.

---

## TL;DR — 5 things to change in the MVP

1. **Add a `setup_tag` field to each thesis** (e.g. `pullback`, `breakout`, `oversold_bounce`). Every retail-journal source rates "setup type" as the highest-leverage non-standard field; we already emit setup classes from the engine — surface them in the YAML schema so post-Inara journal analysis is possible. ([Part 2, Theme A](#theme-a--thesis-tracking-patterns-what-traders-actually-record))
2. **Pin the invalidation taxonomy to the "thesis-type-matched" rule** from 0xkyle/Spectra Markets: a price-action thesis takes a price/volume invalidation; a catalyst thesis takes a news/event invalidation. Reject same-type-only rules at validation time rather than letting users mix them. ([Theme B](#theme-b--invalidation-rule-taxonomy))
3. **Skip Kelly. Add a single optional `risk_pct` field (default 0.5%) and an ATR-based suggested-size hint on the symbol page.** Fixed-fractional + ATR is the consensus retail-pro pattern; Kelly is over-built for someone with no statistically significant trade history. ([Theme C](#theme-c--position-sizing))
4. **Drop the "horizon-approaching" thesis state to a single boolean check at cron time, not a UI status.** The "two-database" anti-pattern (Theme D) plus the Inngest-style over-abstraction in adrianhajdin/signalist (Part 1, #5) suggest every extra state machine bit kills these tools. Compute, don't store.
5. **Make the daily Slack message a digest, not per-fire pings.** Multiple journal sources warn that alert overload is the #1 abandonment trigger; one webhook POST per cron with N bullet points is the right granularity for a freeze-window tool. ([Theme E](#theme-e--mobile-cadence-ui))

---

## Part 1 — Comparable open-source projects

### 1. xang1234/stock-screener (github.com/xang1234/stock-screener · ★48 · last commit 2026-05-11)
- **Stack:** FastAPI + SQLAlchemy + Celery + Redis + Postgres backend, React 18 + Vite + MUI + TanStack Query frontend. yfinance + Finviz + Alpha Vantage + EDGAR.
- **Approach:** 80+ filters, multi-market (9 regions), AI clustering of news/RSS/Twitter into "themes" with lifecycle tracking.
- **Steal:** Watchlist UX with RS-sparklines, multi-period change bars, drag-and-drop folders. Theme lifecycle tracking (trending→emerging→dead) is conceptually close to thesis lifecycle.
- **Avoid:** Per-region Celery queues, paid-LLM dependencies (Minimax/Z.AI), 80+ filter sprawl. Classic "feature density over opinionated workflow."
- **Thesis tracking?** No. Themes ≠ theses; themes are market-wide, theses are personal.
- **Alerts?** Not documented as a first-class feature.
- Source: <https://github.com/xang1234/stock-screener>

### 2. adrianhajdin/signalist_stock-tracker-app (★465 · active, tutorial repo)
- **Stack:** Next.js 15 + TS + Shadcn + MongoDB + Better Auth + Inngest + Finnhub + Nodemailer + Gemini.
- **Approach:** Personal watchlist with user-defined price/volume thresholds; Inngest schedules digests; Nodemailer sends email.
- **Steal:** Next.js 15 + Shadcn watchlist UI patterns. The threshold-rule shape ("if price crosses X" / "if volume > Y") matches our `price_below`/`volume_spike` invalidation types — confirms our schema is conventional.
- **Avoid:** Inngest + Mongo + Nodemailer for what is essentially a daily cron. This is the over-architected version of exactly what our MVP does — proves Vercel cron + Slack webhook is the right call. Better Auth/MFA for a single-user personal tool is gold-plating.
- **Thesis tracking?** No.
- **Alerts?** Yes, threshold-driven, via Inngest workflows.
- Source: <https://github.com/adrianhajdin/signalist_stock-tracker-app>

### 3. achannarasappa/ticker (★6.1k · last release 2026-04, v5.2.1)
- **Stack:** Go, bubbletea TUI, YAML config at `~/.ticker.yaml`, Yahoo + Coinbase.
- **Approach:** Terminal price tracker with YAML-defined watchlist + cost-basis lots.
- **Steal:** **YAML schema layout** — single file, top-level `watchlist:` list, optional `lots:` per symbol. Closely mirrors our planned schema. "Symbols not on watchlist but present in lots are implicitly added" is a nice graceful-degradation pattern.
- **Avoid:** N/A — this is a focused tool that resisted scope creep across 5 major versions.
- **Thesis tracking?** No.
- **Alerts?** No.
- Source: <https://github.com/achannarasappa/ticker>

### 4. asircar/nifty-swing-screener (★2 · early-stage, 11 commits)
- **Stack:** Python 3.12 + FastAPI + yfinance + SQLite + Rich CLI.
- **Approach:** Multi-factor scoring (EMA stack, RSI recovery, MACD cross, support bounce, volume surge), need ≥2 of 5 to qualify. ATR-based stop. Explainable scoring breakdown.
- **Steal:** **Explainable per-factor score badges (clickable for weights)** — directly applicable to our "why blocked" panel. The "≥2 of N signals required" rule is a cleaner public-facing summary than our 6-gate PASS/WATCH/TRADE.
- **Avoid:** Dual CLI + web UI when one suffices. Five signals with no backtest validation — same risk we have.
- **Thesis tracking?** None.
- **Alerts?** None.
- Source: <https://github.com/asircar/nifty-swing-screener>

### 5. zmcx16/Norn-StockScreener (★79 · 459 commits, active workflows)
- **Stack:** React + Gatsby + scraped data (Finviz, Yahoo).
- **Approach:** 40+ fundamental filters, 14 expert strategies, Beneish-Model earnings-manipulation detection, ESG, insider data.
- **Steal:** Pre-canned "expert strategy" presets (e.g. "Greenblatt magic formula") is a nicer entry point than raw filters. Could become our "Setup library" page.
- **Avoid:** Web-scraping fragility, no portfolio/watchlist/alerts. Disclaimer-heavy = data-quality red flag.
- **Thesis tracking?** No.
- **Alerts?** No.
- Source: <https://github.com/zmcx16/Norn-StockScreener>

### 6. Eleven-Trading/TradeNote (★832 · 807 commits)
- **Stack:** Vue + Node 18 + MongoDB + Docker, self-hosted.
- **Approach:** Self-hosted trade journal, per-broker importers.
- **Steal:** **Self-hosted positioning + Docker-compose one-command deploy** validates our "personal tool, no SaaS" framing. Per-broker `/brokers/*` folder structure is a clean modularity pattern if we ever add fills.
- **Avoid:** No visible tag/setup/thesis system in docs — a journal without setup-tagging is what every Part-2 source warns against. Custom `codemirror-graphql` folder = scope creep symptom. MongoDB for a single-user app is overkill.
- **Thesis tracking?** Partial — free-form notes only, no structured thesis schema.
- **Alerts?** No.
- Source: <https://github.com/Eleven-Trading/TradeNote>

### 7. jiwoomap/TradingAgents-Dashboard (★13 · fork of TauricResearch/TradingAgents, 28 commits)
- **Stack:** Python + Streamlit + Docker + OpenAI + vector DB.
- **Approach:** Multi-agent LLM debate (analyst/researcher/trader/risk-manager). "Persistent Memory (RAG)" syncs analysis reports as `.md` files to local vault — Obsidian-compatible.
- **Steal:** **The Obsidian-as-memory pattern.** Reports auto-save as `_summary.md` / `_debate.md` per ticker. This is a v2 idea for us: thesis evaluations write back into the vault as dated notes.
- **Avoid:** LLM-agent-debate as core analysis engine — slow, expensive, non-deterministic. Streamlit UI is a step back from Next.js.
- **Thesis tracking?** Partial via RAG-indexed "Situations" and "Knowledge" notes — interesting but unstructured.
- **Alerts?** Scheduled analysis jobs, not threshold alerts.
- Source: <https://github.com/jiwoomap/TradingAgents-Dashboard>

### 8. chand1012/stonks (★low · narrow scope)
- **Stack:** Python + Alpaca API.
- **Approach:** Watchlist scanner for "uptrend (>200 SMA) pullback to 50 SMA"; 0.5% risk position sizing; bracket orders.
- **Steal:** **0.5% fixed risk default** is what every Part-2 source recommends. Bracket-order math (entry/stop/target) matches our engine output.
- **Avoid:** Auto-executes via Alpaca — out of scope and a known abandonment trap (broker API drift).
- **Thesis tracking?** No.
- **Alerts?** No.
- Source: <https://github.com/chand1012/stonks>

### 9. lit26/Market_Watch (full-stack personal tracker)
- **Stack:** Flask + Python + React.
- **Approach:** Personal stock + options portfolio with signal charts.
- **Steal:** Combined portfolio + watchlist + signals data model.
- **Avoid:** Conventional and unremarkable — no thesis layer.
- **Thesis tracking?** No.
- Source: <https://github.com/lit26/Market_Watch>

### Searched and found nothing notable
- "github trading thesis tracking typescript" — confirms our hypothesis: **structured thesis tracking with typed invalidation rules is genuinely under-represented in OSS.** Every journal tool is post-trade (P&L analytics); every screener is pre-trade (signal generation). The gap we are filling — *during-trade thesis monitoring* — is real.
- Reddit `site:` queries returned nothing useful; r/algotrading discussions on this topic aren't well indexed.

---

## Part 2 — Domain practices (what professional traders actually do)

### Theme A — Thesis-tracking patterns (what traders actually record)

- **Setup type is the highest-leverage field.** Traderssecondbrain calls it "the most important non-standard field" because it enables strategy-level P&L analysis (`tradezella`, `traderssecondbrain`). Sector is "the most commonly omitted field, and the most valuable" for stock traders. Our YAML has `sector_tag` (good) but no `setup_tag` (gap). Source: <https://traderssecondbrain.com/guides/stocks-trading-journal>, <https://www.tradezella.com/blog/how-to-build-a-trade-journal>
- **Decision-journal canonical fields (Farnam Street / Shane Parrish):** date, decision, expected outcome, *confidence level*, key factors, alternatives rejected, emotional state. Review at 6 months. Our schema has roughly half — missing `confidence` and `alternatives_rejected`. Both are cheap to add and force better thinking. Source: <https://fs.blog/decision-journal/>, <https://fs.blog/wp-content/uploads/2017/02/decision-journal_draft3.pdf>
- **Swing-trader-specific fields** the journal sources call out: overnight gap %, days held, sector performance during holding period, market condition (SPY trend) on entry/exit. We already compute SPY context — surface it in the YAML's `history` block when round-trips are recorded.

### Theme B — Invalidation-rule taxonomy

- **The matching rule (0xkyle, Spectra Markets):** "The reasons for cancelling the trade have to be in line with why you took it in the first place… invalidations have to be of the same type." Concretely: a fundamental-catalyst thesis must use catalyst invalidations (e.g. "earnings miss > 10%", "guidance cut", "team change"); a technical-pullback thesis must use price/volume invalidations. Mixing types means your stop fires on noise unrelated to your thesis. Source: <https://0xkyle.substack.com/p/narrative-trading-2-thesis-and-invalidation>
- **Invalidation ≠ stop-loss (IU.com.au, ITI).** A stop is monetary risk; an invalidation is *thesis death*. Stops sit below invalidation. Our schema currently conflates the two — the engine emits `stop` from ATR while the invalidation rule fires on `price_below`. We should let users declare an invalidation level *above* the technical stop, expressing "if it gets here, I was wrong" vs. "if it gets here, I'm cutting risk." Source: <https://iu.com.au/what-is-invalidation-and-how-is-it-different-from-a-stop-loss/>
- **Concrete invalidation triggers used by serious retail/narrative traders** beyond our current `price_below/above/rsi/volume/news_match`:
  - Catalyst-delay invalidation ("expected FDA decision pushed >30d")
  - Team/leadership change (key-person departure)
  - Decisive close back below breakout level (not intraday touch)
  - Loss of right-shoulder low / neckline reclaim
  - Sector-relative weakness (stock down while sector up = thesis-specific deterioration)
  Source: <https://0xkyle.substack.com/p/narrative-trading-2-thesis-and-invalidation>, <https://forexforstarters.com/learn/price-action/chart-patterns/targets-and-invalidation/>
- **Howard Marks' three-question exit framework:** sell when (a) target reached, (b) thesis deteriorated, or (c) better opportunity found. (b) is the only one our tool can detect; (a) and (c) are user-driven. We should label our `exit_target` field accordingly so users mentally separate "auto-detected death" from "manual target reached." Source: <https://www.oaktreecapital.com/insights/memo/selling-out>

### Theme C — Position sizing

- **Consensus among 7+ sources: fixed-fractional (0.5%–2% risk per trade) is the retail default.** ATR-based sizing is the standard upgrade for volatility normalization. Source: <https://medium.com/@ildiveliu/risk-before-returns-position-sizing-frameworks-fixed-fractional-atr-based-kelly-lite-4513f770a82a>, <https://www.thetraderisk.com/how-to-position-size-when-swing-trading/>
- **Kelly is rarely used straight.** "Almost every professional uses Fractional Kelly — typically half- or quarter-Kelly" because full-Kelly requires accurate win-rate/payoff estimates the user does not have without 100+ trades. **Verdict: do not ship Kelly in MVP.** Source: <https://journalplus.co/learn/guides/kelly-criterion-guide/>
- The MVP already has ATR in the engine. Adding a "suggested shares = (risk_pct × equity) / ATR_stop_distance" hint on the symbol detail page is a 30-line change and matches what chand1012/stonks does at the bot level.

### Theme D — Why personal trading tools fail

- **"Two-database problem" is a known antipattern.** Techsslaash describes the canonical death curve: month 2 = missed trades, month 3 = broken formulas after asset-class change, month 6 = abandoned. **Friction is the killer.** Our MVP's vault-YAML-as-source-of-truth is the right response — single editing surface, mobile-editable, git-versioned. Source: <https://www.techsslaash.com/why-most-retail-traders-fail-without-a-trading-journal-and-how-to-fix-it/>
- **Scope creep is the second killer.** Most abandoned trading repos on GitHub (e.g. fearofcode/bateman) failed not because the strategy was bad but because they tried to support too many asset classes, brokers, or modes. **Verdict: hold the line on "stocks only, no auto-execution, no brokerage integration"** during the 30-day window.
- **Alert overload causes user abandonment too.** Journal sources note traders disable notifications when they fire >2–3x/day. Our cron-once-daily-at-16:05-ET design is correct; resist any pressure to add intraday triggers.

### Theme E — Mobile / cadence / UI

- **A "minimum viable routine" is 5 min pre-market + 5 min post-session** — beats 80% of retail traders (Trade That Swing). For a freeze-window user, the post-session digest at 16:05 ET maps directly onto this. Source: <https://tradethatswing.com/do-this-5-minute-day-trading-morning-routine-for-better-results/>
- **Mobile table stakes:** chart loads <1s, alert at price level, ability to adjust stop/target on phone. The MVP doesn't need any of these because Slack DM *is* the mobile surface during the Inara freeze. This is a strength, not a gap.
- **Cadence pattern from Warrior Trading + Trade That Swing:** evening review > morning prep. Swing traders should do real thinking at end-of-day. Our 16:05 ET cron timing aligns.

### Theme F — Decision journal in practice

- **Used by serious traders, often abandoned by casual ones.** Tradezella estimates <10% of retail traders keep a journal past 90 days. The killer field for compliance is **automation**: anything the user has to type manually dies. Source: <https://www.tradezella.com/blog/trading-journal-complete-guide>
- **The "expected outcome with probabilities" field** from Farnam Street is what separates a decision journal from a trade log. Worth borrowing into the `thesis.summary` field as a soft convention: "I expect X to happen with ~60% probability by [date]."
- **Six-month review cadence** matches Parrish's recommendation and is roughly what `time_horizon` already encodes.

---

## Part 3 — Recommendations for our MVP

### Add
- **`setup_tag: enum` to thesis schema** — values from existing engine setup classes (`pullback`, `base_breakout`, `squeeze`, `oversold_bounce`). Cost: one schema line + engine already emits the value.
- **`confidence: 1–5` to thesis schema** — Farnam Street's calibration field. Cost: one schema line. Enables future post-mortem analysis.
- **`risk_pct: number` (default 0.5)** at the top level of the YAML, plus a derived `suggested_shares` hint on the symbol page using ATR-based sizing. No Kelly.
- **Invalidation-type validation rule:** if `thesis.summary` is tagged as a catalyst trade, require ≥1 invalidation with signal type `news_match` or a new `event_delay`/`event_miss` type. Reject at validation time. Mirrors 0xkyle's "matching type" rule.
- **Slack message format:** one digest per cron run, bulleted by ticker with the firing rule name inline. Not N separate webhook calls.

### Remove
- **Kelly / advanced position sizing.** Defer indefinitely.
- **Any per-ticker UI status beyond the 4 states already specified** (`progress / horizon-approaching / horizon-expired / invalidated`). Compute `horizon-approaching` at cron time from `time_horizon`; do not store.
- **The `news_match` evaluator stub if it would block ship.** Spec already marks it deferred — confirm in design.md that absent news plumbing is a no-op, not an error.

### Change
- **Rename `invalidation` → `invalidation_rules`** in the YAML for clarity (matches our internal language and the 0xkyle source).
- **Surface the distinction between `stop_price` (risk) and `invalidation_price` (thesis death).** The symbol page should display both. Stop comes from engine; invalidation_price comes from the YAML.
- **History entries should include `setup_tag` and SPY-trend-on-exit** retrospectively — cheap to add now, expensive to backfill later.

---

## Part 4 — Open questions raised by this research

1. **Should the YAML support multiple invalidation rules with explicit AND/OR semantics, or always OR?** Current schema implies OR-of-list. Catalyst+technical theses may want "fire only if price AND news both trigger."
2. **Where does the Farnam Street `alternatives_rejected` field live?** It's high-leverage for learning but adds friction. In YAML as optional? In Obsidian only?
3. **Does the digest Slack message include "thesis still healthy" pings, or only firings?** Silence-is-good is cleaner but harder to debug. Suggest a once-weekly "all clear" summary on top of the daily fire-only message.
4. **How does `setup_tag` interact with the engine's `setup` output when they disagree?** If user says `pullback` but engine sees `squeeze`, that itself is a signal worth surfacing.
5. **Should `dropped` history rows feed a future "post-mortem" view?** Trivial data model question now, but locking the schema before answering will hurt later.
6. **Vault path: hard-code `swing-trader-demo/data/watchlist.yaml` or make it env-configurable?** Cross-machine portability vs. simplicity.
