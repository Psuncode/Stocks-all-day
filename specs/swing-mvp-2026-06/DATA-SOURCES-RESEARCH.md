# Data sources research — what would materially upgrade the engine

Generated: 2026-05-19
Author: research agent (read-only survey)
Scope: candidates that could materially upgrade the swing-trader engine within a Vercel Hobby + single-user budget, evaluated against the v3.0 plan's explicit "skip" list.

---

## Summary

After surveying ~20 candidates across news, insider flow, earnings, options, sentiment, macro, fundamentals, AI, and real-time feeds, the only sources worth wiring up before they pay rent are: **(1) Finnhub** as a multi-purpose freebie that solves the `news_match` stub *and* gives us a sane earnings-calendar fallback if Yahoo breaks; **(2) SEC EDGAR directly** for Form-4 insider clusters (the one academically-validated alt-signal that's both free and low-maintenance); **(3) FRED expansion** to add T10Y2Y, T10Y3M, and HYG-as-credit-proxy to the macro strip; **(4) StockTwits public stream endpoints** as a cheap watchlist-only sentiment overlay, *not* a scanner gate. Everything else — Polygon, Alpha Vantage, NewsAPI.org, Marketaux, Reddit, Unusual Whales, Groq, OpenFIGI, real-time WebSockets — either underperforms the current free Yahoo stack on free-tier limits, is duplicative, or has a signal-to-noise profile that doesn't survive contact with a single-user discretionary workflow.

**Shortlist to actually wire up (in order):**

1. **Finnhub** — solve `news_match`, add an earnings-calendar mirror, hedge yahoo-finance2 breakage. ~3 hours.
2. **SEC EDGAR Form 4** — watchlist-only insider-cluster chip. ~4 hours.
3. **FRED macro expansion** — add T10Y2Y / T10Y3M / HYG to existing strip. ~1 hour.
4. **StockTwits public trending endpoint** — sentiment chip on watchlist cards only. ~2 hours.

Total ~10 hours, all post-Aug-17 (none fit the 8-hour pre-freeze budget already allocated to T1–T6).

---

## Top recommendations (ranked)

### 1. Finnhub — single API that solves three problems at once

- **Cost:** Free tier is **60 calls/minute**, no daily cap on US equity data, no credit card. ([finnhub.io/pricing](https://finnhub.io/pricing-stock-api-market-data))
- **Signal quality:**
  - `company-news` endpoint: aggregated press releases + financial news per ticker with headline + source + URL. Quality is *fine for catalyst-tagging*, not deep enough to do real NLP sentiment, but exactly the right shape to back the existing `news_match` stub in `lib/thesis/evaluate-rules.ts`.
  - `earnings-calendar` endpoint: cross-market list of upcoming earnings with date + EPS estimate. **More importantly, it lets us cross-check Yahoo's per-symbol earnings field** — which we already had an H2 fix for in v1.9.
  - `stock/recommendation` (analyst ratings aggregate) and `stock/insider-transactions` available on free tier as bonus signals.
- **Integration effort:** ~3 hours. Patterned after `lib/data/fred.ts`: thin fetch wrapper, `unstable_cache` with 1-hour TTL for news (since the digest cron runs once daily) and 6-hour TTL for the earnings calendar. The news endpoint accepts `?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD`, perfect for the watchlist-only path.
- **Use case fit:**
  - Wires the `news_match` invalidation rule from "pending_news_source" to actually firing. Pattern matching can be simple substring (or regex) against headlines from the last 24h, matching the `rule.pattern` field that's already in the schema.
  - The Slack digest could optionally include "Top headline today" per watchlist ticker — directly improves the digest's information density.
  - The symbol page's "Overview / On the roadmap" fundamentals placeholder can become "Recent headlines (Finnhub)" — that's a credible, real upgrade vs. an open-ended "fundamentals coming soon".
- **Failure modes / maintenance:**
  - 60 req/min is generous — even a 50-ticker watchlist + 20 cron pulls = 70 req per cron run, which fits.
  - Finnhub free tier has historically been stable; the company is VC-backed (not a hobby project), been around since 2017, and explicitly markets the free tier.
  - Risk: schema changes on free tier endpoints. Mitigation: defensive parsing (we already do this with yahoo-finance2).
- **Concrete integration sketch:**
  - `lib/data/finnhub.ts` — `fetchCompanyNews(ticker, sinceDate): Promise<NewsItem[]>`, `fetchEarningsCalendar(from, to): Promise<EarningsEntry[]>`.
  - Env: `FINNHUB_API_KEY` (server-only).
  - Cache: `unstable_cache` 1h for news, 6h for calendar.
  - Wire `news_match` in `evaluate-rules.ts` so that when a rule's `pattern` substring matches any headline in the last 24h for that ticker, it fires (with stateless 7-day dedup against the same pattern, matching the existing pattern).

### 2. SEC EDGAR Form 4 — the one alt-signal with real academic backing

- **Cost:** Free, no API key. ([sec.gov/edgar-apis](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)) Requires a descriptive `User-Agent` header and a 10 req/sec ceiling — trivial for our scale.
- **Signal quality:** The strongest alt-data signal that's both free and has independent academic support. Lakonishok & Lee (2002, RFS) found stocks with heavy insider buying outperformed by ~4.8% over 12 months. Cohen-Malloy-Pomorski (2012, JF) showed "opportunistic" (non-routine) insider buys generated ~5.2% 6-month alpha. ([Alpha Architect](https://alphaarchitect.com/a-unique-insider-trading-signal-that-generates-alpha/)) **Important caveat:** more recent work (Ozlen & Batumoglu 2024, [SSRN 5966834](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5966834)) finds most returns now occur *before* the 4-day Form 4 disclosure window, meaning you cannot front-run the filing — but the *clustered* pattern (multiple insiders buying within a short window) remains a useful confirming signal for an existing technical setup. That's exactly how a swing tool should use it: not as a primary entry trigger, but as a tier-1 "this technical setup has additional conviction" marker.
- **Integration effort:** ~4 hours. The endpoint is `https://data.sec.gov/submissions/CIK##########.json` which lists recent filings; Form 4 filings need a follow-up XML fetch from the archives. The ticker-to-CIK mapping is also free at `https://www.sec.gov/files/company_tickers.json` (single-file daily download, cache as a JSON map for the watchlist only — we don't need it for the full 600-ticker universe).
- **Use case fit:** Watchlist card adds a small chip: "Insiders: 3 buyers, 30d" colored emerald if cluster buying (≥2 distinct insiders, net buy), neutral grey otherwise. Click expands to a list. This sits next to the proposed T5 earnings chip from PLAN-v3.0. The signal is *not* useful for the scanner — broadcasting Form-4 status across 600 tickers would burn the SEC rate limit and the signal-to-noise on a screened universe is much worse than on a curated thesis list.
- **Failure modes / maintenance:** EDGAR endpoints are *very* stable; this is gov infrastructure, not a startup. Risk is User-Agent enforcement (we'd set `User-Agent: trader.psunproduction.com - inaradiagnostics@gmail.com`). Maintenance: nil — the schemas have been stable for years.
- **Concrete integration sketch:**
  - `lib/data/edgar.ts` — `fetchTickerToCik()` (cached 24h via `unstable_cache`), `fetchRecentForm4(cik, since: Date)`.
  - Form 4 XML parsing: only need acquired/disposed totals and the insider's role (D/O/10%) — keep parsing minimal. Use `fast-xml-parser` (already on yarn.lock most likely; if not, ~30KB add).
  - Wire only on watchlist render. Cache per-ticker results 6 hours.
  - **Reverses PLAN-v3.0's skip verdict** — that line ("we already have earnings dates from Yahoo. Adding filing dates is overlap; minimal new info") was right about 8-K dates being redundant, but wrong by extension about Form 4. Form 4 isn't an earnings date; it's a clustered-insider-buying signal with documented alpha.

### 3. FRED macro expansion — three more series, ~30 minutes of work

- **Cost:** Free, same API key already provisioned. No documented rate cap; daily-updated series so a 1-hour cache is overkill.
- **Signal quality:** The existing strip (VIX, 10Y, Fed funds) misses two valuable regime signals:
  - **T10Y2Y** (10Y-2Y spread): the canonical recession indicator. Useful as a *context label* in the macro strip — when negative, the engine could downgrade trend-continuation setups (this is well-supported by [FRED Blog data](https://fredblog.stlouisfed.org/tag/t10y2y/)).
  - **T10Y3M** (10Y-3M spread): NY Fed's preferred recession probability input.
  - **BAMLH0A0HYM2** (ICE BofA US High Yield Index Option-Adjusted Spread, daily) as the cleanest "credit stress" proxy. Beats trying to scrape HYG ETF price action because OAS already controls for duration.
- **Integration effort:** ~1 hour. Just adds three more series IDs to the existing `fetchSeries` calls in `lib/data/fred.ts`. The MacroStrip component grows from 3 chips to 5–6.
- **Use case fit:** The macro strip is already the highest-leverage info-per-pixel surface in v3.0. Adding "Yield curve" and "Credit OAS" trains the user's eye to read regime in 2 seconds. Don't gate any engine rules on these — they're context, not triggers.
- **Failure modes / maintenance:** Nil. FRED is more stable than the SEC.
- **Concrete integration sketch:**
  - Edit `lib/data/fred.ts`: add `T10Y2Y`, `T10Y3M`, `BAMLH0A0HYM2` to the existing `Promise.all`.
  - Edit `components/MacroStrip.tsx`: render the additional chips; on mobile, only show VIX + T10Y2Y + Credit OAS in the collapsed view.

### 4. StockTwits public trending endpoint — sentiment chip on watchlist only

- **Cost:** Free, no auth. The public read endpoints (`https://api.stocktwits.com/api/2/streams/symbol/{TICKER}.json` and `https://api.stocktwits.com/api/2/trending/symbols.json`) require no API key. ([StockTwits dev portal](https://api.stocktwits.com/developers))
- **Signal quality:** Honest verdict: **medium-low**, but with a defined and bounded use case. The academic record is mixed-positive: a Springer Digital Finance study (2023) found cumulative abnormal sentiment polarities provided usable signal *with appropriate threshold choices*; an ArXiv backtest (2507.03350, 2025) reported a long/short combining message-volume spikes with sentiment shifts at +13.78% annualized / Sharpe 1.07. But these are research conditions with careful filtering, not a real-time chip. **For our use case (a single-user discretionary tool, not a quant strategy), the right framing is "social attention contrarian / confirmation" — i.e. when message volume spikes 5x on a watchlist ticker, that's a flag worth noticing, not a buy signal.**
- **Integration effort:** ~2 hours. Single endpoint per watchlist ticker, compute message-count vs. 7-day baseline.
- **Use case fit:** Watchlist card chip: "Buzz: 12 msgs/24h (3.2× baseline)". Color amber if >3×, red if >10×. Click expands to the StockTwits page in a new tab. Do NOT add to scanner — 600 tickers × stocktwits-stream-per-ticker = ToS abuse risk + the signal is too noisy at scale.
- **Failure modes / maintenance:** StockTwits has paused new API registrations as they "review APIs, documentation and terms" — so the public endpoints could be locked down or rate-throttled at any point. Mitigation: graceful fail (the watchlist works without the chip). Don't ever depend on this for engine logic.
- **Concrete integration sketch:**
  - `lib/data/stocktwits.ts` — `fetchSymbolBuzz(ticker): Promise<{ msgs24h: number, baseline7d: number }>`. Public endpoint, no key. Cache 1 hour.
  - Watchlist card renders the chip only if `msgs24h > 1.5 * baseline7d`; otherwise hide.
  - Document the ToS fragility in the file header.

### 5. (Optional) Groq as Gemini fallback for the explainer — only if you ever hit Gemini quota

- **Cost:** Groq free tier is 30 req/min, ~1,000 req/day, with sub-200ms TTFT on Llama 3.3 70B. Gemini Flash free is 1,500 req/day. ([Groq free tier breakdown](https://tokenmix.ai/blog/groq-free-tier-limits-2026))
- **Signal quality:** Equivalent for "explain this trade in one paragraph". Llama 3.3 70B is competitive with Gemini Flash on this task.
- **Verdict:** PLAN-v3.0's "skip — two LLMs to maintain" is correct in spirit, but as a *zero-config-default-off fallback* it's almost free to add. The only real win is latency (200ms vs. ~1s for Gemini Flash) — likely not perceptible behind the scanner's existing 15-min cache.
- **Recommend: skip unless you actively hit a Gemini outage.** Affirms PLAN-v3.0.

---

## Pass / skip with reasoning

| Source | Verdict | Reasoning |
|---|---|---|
| **Polygon.io** | **Skip — affirms v3.0** | Free tier is 5 calls/min ([Polygon KB](https://polygon.io/knowledge-base/article/what-is-the-request-limit-for-polygons-restful-apis)). Yahoo gives us a 600-ticker scan with no auth. Polygon's free tier loses on every axis. Paid plans start at $199/mo — not justified. |
| **Alpha Vantage** | **Skip — affirms v3.0** | Free tier was 500 → 100 → now **25 requests per day** with 5 req/min ([Macroption](https://www.macroption.com/alpha-vantage-api-limits/)). Useless for a daily 600-ticker scan. The brainstorm's "indicators via Alpha Vantage" was always wrong — we compute RSI/ATR/SMA from candles client-side. |
| **NewsAPI.org** | **Skip — affirms v3.0** | Free tier is 100 req/day **AND restricted to localhost only** ([NewsAPI pricing](https://newsapi.org/pricing)). Production-incompatible. Paid plan jumps to $449/mo. Hard skip. |
| **Marketaux** | **Skip** | Free tier is 100 req/day with limited filtering ([marketaux pricing](https://www.marketaux.com/pricing)). Comparable to NewsAPI but slightly worse. Finnhub (60/min, no daily cap) dominates. |
| **Tiingo** | **Skip** | Free tier exists but news API specifics are gated behind sign-up and the volume limits aren't generous enough to bet a digest pipeline on. EOD prices are their strength, which we already have from Yahoo. |
| **Benzinga free tier** | **Skip with caveat** | AWS Marketplace "Basic Financial News API (free tier)" exists ([AWS listing](https://aws.amazon.com/marketplace/pp/prodview-xwgvhwowjmw3g)) but provisioned through AWS Marketplace = added infra surface for a personal tool on Vercel. Finnhub's free tier covers the same need with less ceremony. |
| **GDELT 2.0 DOC API** | **Skip — interesting but wrong fit** | Genuinely free, no key, 3-month rolling window. But it returns *URLs and CAMEO event codes*, not full article text or stock-tagged catalyst classification. Best-suited to macro/geopolitical signal extraction, not "did NVDA get a catalyst headline today". Finnhub's per-ticker news endpoint is the right tool. |
| **Tradier sandbox** | **Skip** | Real-time quotes require an actual brokerage account ([Tradier docs](https://documentation.tradier.com/brokerage-api/markets/get-quotes)); sandbox is 15-min delayed (same as Yahoo). Zero gain. |
| **Alpaca / IEX feed** | **Skip — affirms scope** | Free real-time is IEX-only (~3% of total US equity volume) and gated to Alpaca brokerage account holders. Out of scope per the "no brokerage" constraint. |
| **IEX Cloud** | **Skip — defunct** | IEX Cloud shut down in 2024. Listed for completeness; brainstorm-era mention is stale. ([Alpha Vantage migration page](https://www.alphavantage.co/iexcloud_shutdown_analysis_and_migration/)) |
| **Twelve Data** | **Skip** | Free tier is 8 calls/min, 800/day ([Twelve Data trial](https://support.twelvedata.com/en/articles/5335783-trial)). Better than Polygon but no advantage over Yahoo + Finnhub combo. Their fundamentals are gated to paid plans. |
| **Financial Modeling Prep** | **Skip for now** | Free tier is **250 calls/day**, 500MB/30d bandwidth ([FMP pricing](https://site.financialmodelingprep.com/pricing-plans)). Could feasibly fill the "fundamentals: coming soon" slot for the symbol page (income statement / ratios for a single ticker click). But the user has explicitly said they pivot to Google Finance for fundamentals — building this in is solving a problem the user already routes around. Defer. |
| **Reddit / r/WSB sentiment** | **Skip — affirms v3.0** | Free tier is 100 req/min, **non-commercial only**, and Reddit's ToS restricts automated collection ([Reddit pricing breakdown](https://octolens.com/blog/reddit-api-pricing)). Even on signal: r/wallstreetbets is meme-driven and contrarian-positive on terrible setups. The brainstorm's optimism was misplaced. Affirms. |
| **Unusual Whales free** | **Skip — affirms v3.0** | "Free tier" is a delayed, ad-supported web UI; the API is paid-only with WebSocket gated to Advanced ([UW pricing](https://unusualwhales.com/pricing)). $55/mo for Standard. Out of scope and out of budget for a personal tool. The engine is technical-pattern-based; options flow is a different game. |
| **Cheddar Flow / OptionStrat free** | **Skip** | Same reality — "free tier" is web access only; API is paid. |
| **OpenFIGI** | **Skip — affirms v3.0** | Ticker → ISIN mapping with no brokerage integration on roadmap = premature. |
| **EDGAR 8-K / 10-Q** | **Skip** | Redundant with Yahoo's earnings dates. Form 4 (above) is the only EDGAR signal worth wiring. |
| **Groq fallback** | **Skip — affirms v3.0** | See #5 above. |
| **Real-time WebSocket feeds** | **Skip** | Our 15-min cache is deliberate (cost, complexity, and we're not day-trading). The user trades swings on signals that resolve over days, not seconds. |
| **OpenBB Terminal** | **Skip as data source** | It's an aggregator, not a primary source — it wraps the same APIs we'd be calling. Useful for *user research / exploration*, not for runtime data. |
| **ETF flow data (ETF.com, Massive ETF Global)** | **Skip — interesting but expensive to wire** | Real ETF flow data is gated behind paid APIs (Massive starts at $199/mo). The free web tools (ETF.com, ETF DB) are scrape-only — fragile. Our sector heat map (T3) is already computed from price action of constituents; flow data would be additive but not transformative. Defer to post-freeze. |

---

## What I'd avoid even if free

- **Sentiment NLP via LLM at scan time.** Running Gemini/Groq inference across 600 tickers' headlines per cron is wasteful and adds non-determinism to the engine. Sentiment overlays only make sense on the watchlist (handful of tickers).
- **Scraping Yahoo screener via undocumented endpoints** beyond what `yahoo-finance2` already does. Every additional unofficial endpoint we depend on multiplies the surface area for silent breakage. Stick to the library wrapper.
- **Reddit / X mention counters as engine inputs.** The signal exists in research conditions; in production for a single user, it's mostly theater that creates false confidence. If you want a "buzz" surface, StockTwits public endpoint is sufficient and explicitly *not* an engine input.
- **Real-time options flow.** Unless the strategy is options-based (it isn't), this is signal you can't act on.
- **Building your own historical news archive.** Storage + ingestion costs are non-trivial even on Hobby tier; lean on the providers' rolling windows.

---

## Implementation prioritization for v3.x and beyond

**Pre-freeze (2026-06-17 cutoff):** stick to PLAN-v3.0's T1–T6. Don't add new external dependencies before the freeze. Period.

**Post-freeze, Sprint 1 (one weekend, ~10 hours):**
1. **Finnhub wire-up** (3h): `lib/data/finnhub.ts`, env var, `news_match` rule activation, optional digest "top headline" line. Risk: refactoring the rule evaluator. Reward: closes the only documented "v1 stub" in the engine.
2. **FRED macro expansion** (1h): add T10Y2Y / T10Y3M / BAMLH0A0HYM2 to the existing strip. Zero-risk. Trivial commit.
3. **SEC EDGAR Form-4** (4h): `lib/data/edgar.ts`, watchlist chip, ticker→CIK cache. Risk: XML parsing edge cases. Reward: the one alt-data signal with academic backing.
4. **StockTwits buzz chip** (2h): watchlist-only, soft-fail. Risk: API may go dark. Reward: low — but cheap insurance against the user feeling like they're missing chatter.

**Post-freeze, Sprint 2+ (deferred / opportunistic):**
- **Trade journal** (1-2 weekends): per PLAN-v3.0 §2 — this is the next big unlock, dwarfs any new data source in long-term value.
- **Backtest replay mode** (1 weekend): use the per-symbol 252-day candle archive we already maintain.
- **FMP fundamentals for symbol page** (1 weekend): only if the user reports actually wanting in-app fundamentals vs. Google Finance pivot.
- **ETF flow data** (1 weekend): only if the sector heat map (T3) proves to be a heavily-used surface and we want to deepen it.

**Anti-roadmap (don't):**
- Polygon, Alpha Vantage, NewsAPI.org, Marketaux, Reddit, Unusual Whales, real-time WebSockets, Twitter/X, custom news archive, OpenFIGI, IEX Cloud (defunct), Tradier real-time, browser-local API keys.

**One meta-note:** the engine's marginal next-improvement is not another data source. It's the trade journal — closing the feedback loop on the user's actual decisions. Every data-source upgrade above is worth less than knowing "the engine said TRADE 47 times last quarter; the user took 11 of them; 7 were winners." Build that, then come back for sentiment and flow data when there's a measurable hit rate to improve.

---

## Sources

- [Marketaux pricing](https://www.marketaux.com/pricing)
- [Polygon.io request limits KB](https://polygon.io/knowledge-base/article/what-is-the-request-limit-for-polygons-restful-apis)
- [Finnhub pricing](https://finnhub.io/pricing-stock-api-market-data) / [Finnhub earnings calendar docs](https://finnhub.io/docs/api/earnings-calendar)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Alpha Architect — insider-trading alpha](https://alphaarchitect.com/a-unique-insider-trading-signal-that-generates-alpha/)
- [SSRN 5966834 — The Death of Insider Trading Alpha](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5966834)
- [GDELT DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)
- [Reddit API pricing 2026](https://octolens.com/blog/reddit-api-pricing)
- [StockTwits Developer Portal](https://api.stocktwits.com/developers)
- [Springer Digital Finance — StockTwits sentiment paper](https://link.springer.com/article/10.1007/s42521-023-00102-z)
- [ArXiv 2507.03350 — Backtesting Sentiment Signals](https://arxiv.org/pdf/2507.03350)
- [Benzinga Basic News API (free tier) on AWS](https://aws.amazon.com/marketplace/pp/prodview-xwgvhwowjmw3g)
- [Unusual Whales pricing](https://unusualwhales.com/pricing)
- [Financial Modeling Prep pricing](https://site.financialmodelingprep.com/pricing-plans)
- [Alpaca data plans](https://alpaca.markets/data) / [Tradier docs](https://documentation.tradier.com/brokerage-api/markets/get-quotes)
- [Alpha Vantage rate limit history (Macroption)](https://www.macroption.com/alpha-vantage-api-limits/)
- [Groq free tier 2026](https://tokenmix.ai/blog/groq-free-tier-limits-2026) / [Gemini API pricing 2026](https://tokenmix.ai/blog/gemini-api-pricing)
- [Twelve Data free trial](https://support.twelvedata.com/en/articles/5335783-trial)
- [NewsAPI.org pricing](https://newsapi.org/pricing)
- [FRED T10Y2Y series](https://fredblog.stlouisfed.org/tag/t10y2y/) / [T10Y3M series](https://fred.stlouisfed.org/series/T10Y3M)
- [yahoo-finance2 npm](https://www.npmjs.com/package/yahoo-finance2) (stability caveats)
- [Upstash / Vercel KV pricing](https://www.buildmvpfast.com/api-costs/cache)
- [IEX Cloud shutdown analysis](https://www.alphavantage.co/iexcloud_shutdown_analysis_and_migration/)
