# PLAN-v4.2 — Tier-2 polish sweep + Finnhub wire-up

**Date:** 2026-05-19
**Source reports:**
- `PLAN-v4.1.md` §3 deferred-to-v4.2 list (M1–M6 polish items)
- `DATA-SOURCES-RESEARCH.md` §"Top recommendations #1" (Finnhub, ~3h)

**Headline:** v4.1 shipped clean (zero criticals, three commits on `main`). This batch closes the six medium polish items the v4.1 plan deferred and wires Finnhub to retire the `news_match` stub before freeze. ~4 hours total wall time at single-developer pace; ~1 evening with a 4-agent fan-out.

---

## 1. Scope (deduped from PLAN-v4.1 §3 + DATA-SOURCES-RESEARCH)

| ID | Severity | Issue | Fix |
|---|---|---|---|
| **M1** | 🟡 UI | `SectorHeatMap.tsx` cells truncate long sector names at 320 px; `title=` exists but doesn't surface on touch | Allow 2-line wrap (`whitespace-normal break-words leading-tight` on the name span) + give the card a `min-h-[3.25rem]` so the row stays uniform. Keep the `title=` for desktop hover. |
| **M2** | 🟡 UI | `MacroStrip.tsx` VIX/10Y tone-flip is correct (rising = bad) but opaque | Add a `title=` on the cell wrapper: VIX → "Rising VIX = elevated fear (treated as risk-off)", 10Y → "Rising yields = tighter financial conditions". Trivial; matches existing UI patterns. |
| **M3** | 🟡 Code | `app/layout.tsx:84` awaits `getMacroSnapshot()` on every RSC render → TTFB tax even for routes that don't render the strip | Move the `await` into `MacroStrip` itself (make it an async server component), wrap with `<Suspense fallback={null}>` in the layout. Layout renders instantly; macro streams in. |
| **M4** | 🟡 UI | `TradeCardMobile` wraps the row in `<button>` — blocks text selection / long-press copy of tickers and prices | Convert to `<div role="button" tabIndex={0} onClick={…} onKeyDown={…}>` with Enter+Space activation. Preserve focus ring (`focus-visible:` selector). |
| **M5** | 🟡 UI | Watchlist thesis card stacks two thin bars (`h-1` horizon-elapsed + `h-1.5` price-progress) plus the horizon badge — three signals saying "time/distance left" | Drop the `h-1` horizon-elapsed bar (`_thesis-card.tsx:208-221`). The horizon Badge already says "26d left" and is more legible. Keep the price-progress bar (different info). |
| **M6** | 🟡 UI | Scanner sparkline 50×20 — line stroke ~1.25 px is wider than per-bar pitch on 30 closes; reads as fuzz | Bump default to 72×24 in `components/Sparkline.tsx`. Caller code already passes `width`/`height` overrides where it matters. |
| **F1** | 🟢 Feat | `news_match` rule is a v1 stub (`lib/thesis/evaluate-rules.ts:150-159`) flagged `pending_news_source` | Add `lib/data/finnhub.ts` with `fetchCompanyNews(ticker, sinceDate)` (1-hour `unstable_cache`, soft-fail on missing key). Wire into `evaluateRule()` so `news_match` actually fires when a headline in the last 24h matches `rule.pattern` (case-insensitive substring). Defensive: if `FINNHUB_API_KEY` unset → keep `pending_news_source` status (existing behavior). |

**Out of scope** (still deferred): SEC EDGAR Form 4, FRED macro expansion (T10Y2Y/credit OAS), StockTwits buzz chip, tracking-em zoo, skeleton color drift. All per DATA-SOURCES-RESEARCH §"Post-freeze Sprint 1+".

---

## 2. Agent partitioning (parallel-safe)

Four `gsd-executor`-style agents, disjoint files per CLAUDE.md §"When dispatching agents":

### Agent A — chrome + macro (M2 + M3)
**Files:** `app/layout.tsx`, `components/MacroStrip.tsx`
**Effort:** ~25 min

1. In `MacroStrip.tsx`, change the export to an async server component that calls `getMacroSnapshot()` internally; keep the early-return-null contract when snapshot is missing.
2. In `app/layout.tsx`, remove the `const macroSnapshot = await getMacroSnapshot()` line and the `RootLayout` `async` modifier if no other awaits remain. Render `<Suspense fallback={null}><MacroStrip /></Suspense>` instead (import from `react`).
3. Add `title=` attributes to the VIX and 10Y `<Cell>` invocations in `MacroStrip`. Pass a new optional `tooltip?: string` prop on `Cell` and wire it onto the outer `<div className="flex items-baseline gap-2">` — keep Fed Funds untitled.

### Agent B — pure components (M1 + M6)
**Files:** `components/SectorHeatMap.tsx`, `components/Sparkline.tsx`
**Effort:** ~15 min

1. `SectorHeatMap.tsx`: change `<div className="truncate text-xs font-semibold">{s.sector}</div>` to `<div className="text-xs font-semibold leading-tight break-words" title={s.sector}>{s.sector}</div>`. Add `min-h-[3.25rem]` (or equivalent) to the card `<div>` so heights stay uniform even with wrap.
2. `Sparkline.tsx`: default `width = 72, height = 24`. Keep the stroke at 1.25 (now narrower than per-bar pitch on 30 closes: 72/29 ≈ 2.5 px).
3. Verify scanner desktop table column still fits — `scanner-client.tsx:753` passes no overrides, so it now renders 72×24. Check the row doesn't reflow.

### Agent C — watchlist + journal pages (M4 + M5)
**Files:** `app/watchlist/_thesis-card.tsx`, `app/journal/journal-client.tsx`
**Effort:** ~30 min

1. `_thesis-card.tsx`: delete the `{pctElapsed !== null && (…h-1…)}` block at lines ~204-222. The horizon Badge two flex rows above still conveys the same info. Leave `pctElapsed` import + computation in place if it's still referenced elsewhere; otherwise drop unused refs.
2. `journal-client.tsx:807-848` (`TradeCardMobile`): swap the outer `<button type="button" onClick={onClick}>` for `<div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>`. Keep the same Tailwind classes; add `focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 focus-visible:outline-offset-2` (or rely on the global focus-visible rule — verify).
3. Type the `onClick` prop as `() => void`; type the `onKeyDown` inline.

### Agent D — Finnhub wire-up (F1)
**Files:** `lib/data/finnhub.ts` (new), `lib/thesis/evaluate-rules.ts`, `.env.local.example` (if it exists; otherwise document in CLAUDE.md `Env vars` section in a follow-up commit)
**Effort:** ~90 min

1. Create `lib/data/finnhub.ts`:
   - `export type NewsItem = { headline: string; source: string; url: string; datetime: number /* unix seconds */ };`
   - `async function fetchCompanyNewsUncached(ticker: string, sinceDate: string): Promise<NewsItem[]>` — calls `https://finnhub.io/api/v1/company-news?symbol=${TICKER}&from=${sinceDate}&to=${today}&token=${FINNHUB_API_KEY}`. Soft-fail: return `[]` if key missing or fetch fails. Defensive parsing (only keep entries with a non-empty `headline`).
   - `export const fetchCompanyNews = unstable_cache(fetchCompanyNewsUncached, ["finnhub-company-news-v1"], { revalidate: 60 * 60, tags: ["finnhub-news"] });`
   - Add `serverExternalPackages` check? No — `finnhub` is plain `fetch`. No package needed.
2. `evaluate-rules.ts`: change the `evaluateRule` signature to accept an optional `newsHeadlines?: string[]` param (caller-provided, already-fetched). Don't fetch inside the evaluator — it's pure today and should stay pure.
3. In the `news_match` case: if `newsHeadlines` is `undefined` → return existing `pending_news_source` status. If provided → case-insensitive substring match against `rule.pattern`. `fired = headlines.some(h => h.toLowerCase().includes(rule.pattern.toLowerCase()))`. `suppressed = false` (no stateless dedup window for news without per-day timestamps; safe default). `observed = headlines.length` (count of recent news), `threshold = rule.pattern`.
4. Update `lib/thesis/evaluate-rules.ts` callers: search for `evaluateRule(` usages. If a caller knows the ticker, it can pre-fetch news. **Default to undefined** for now — wiring real callers is a v4.3 follow-up. The point of this commit is to make the evaluator news-aware, not to wire every caller.
5. Manual env-var hygiene: add `FINNHUB_API_KEY` to the CLAUDE.md prod env list in a separate trailing commit (not blocked on Vercel provisioning).

---

## 3. Verification (after all 4 agents commit)

Run from `swing-trader-demo/`:

```bash
npx tsc --noEmit       # clean
npm run lint           # clean
npm run build          # clean — Next 16 + yahoo-finance2 bundling guards still hold
```

**Smoke (local `npm run dev`):**
1. Visit `/scanner` on a 375 px (iPhone SE) viewport — sparkline reads as a clean line, sector heat map cells wrap (no truncation), heights uniform.
2. Visit `/` (or any route) — page renders without waiting on FRED; macro strip appears a beat later (or not at all if no key).
3. Hover VIX/10Y cells in the macro strip — tooltip surfaces the rationale.
4. Visit `/journal` on mobile, long-press a trade card ticker — text selection works (was blocked by `<button>`).
5. Tab to a journal mobile card → Enter → edit drawer opens.
6. Visit `/watchlist` — thesis cards show ONE horizon Badge + price-progress bar (no thin grey/amber horizon-elapsed bar above).
7. Confirm `news_match` rules still return `pending_news_source` status in `/symbol/<ticker>` because no callers pass headlines yet — F1 is a wiring foundation, not a behavior change.

**Production smoke (post-deploy, optional):**
- `vercel env ls` — confirm `FINNHUB_API_KEY` slot exists (user adds the actual value separately).
- Visit `trader.psunproduction.com/scanner` — verify the polish lands.

---

## 4. Commit message conventions

Match v4.1's style — one commit per agent, scope-prefixed:

```
ui(v4.2-M1+M6): sector heat map wrap + sparkline 72x24
ui(v4.2-M2+M3): macro strip tooltips + suspense-streamed FRED
ui(v4.2-M4+M5): journal mobile card semantics + watchlist horizon dedup
data(v4.2-F1): finnhub news wiring (news_match rule activated)
```

A trailing `docs(v4.2): CLAUDE.md env-var note for FINNHUB_API_KEY` commit closes the loop.

---

## 5. Out-the-door criteria

This batch ships when:
1. ✅ Four agent commits + one docs commit on `main`
2. ✅ `tsc` + `lint` + `build` green
3. ✅ Each smoke test in §3 passes locally
4. ⏸️ Optional: user provisions `FINNHUB_API_KEY` on Vercel + adds a v4.3 follow-up to wire real callers (single-symbol page is the natural surface)

After this lands, freeze the tool until 2026-08-17 per the strategic-priorities section of CLAUDE.md.

---

## 6. Deferred to v4.3+ (post-Inara)

- Wire real `news_match` callers (`/api/check-invalidations`, `/symbol/[ticker]` page) — needs per-thesis news fetch + cache-key design
- SEC EDGAR Form 4 cluster chip on watchlist (~4h)
- FRED macro expansion: T10Y2Y, T10Y3M, BAMLH0A0HYM2 chips (~1h)
- StockTwits buzz chip on watchlist (~2h)
- Tracking-em zoo + skeleton color drift (Tier-3 pattern drift, UI-3 H5/M10)
- Backtest replay harness
