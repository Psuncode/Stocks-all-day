# PLAN-v4.1 — Post-v4.0 fix batch

**Source reports** (all dated 2026-05-19):
- `REVIEW-4.md` — pass-4 code review (0 critical · 3 high · 6 medium · 4 low · 3 info)
- `UI-REVIEW-3.md` — pass-3 UI audit (16/24 grades; pattern drift on v3.0/v4.0 surfaces)
- `JOURNAL-MATH-VERIFICATION.md` — all 11 math cases pass; 3 low findings overlap REVIEW-4

**Headline:** zero critical defects across all three pass-4 reviews. The journal math itself is correct. What's left is a handful of high-severity polish gaps (off-by-one, docstring lies, a11y gaps, missing nav link) plus medium drift — all closeable in one batch before freeze.

---

## 1. Severity-ranked findings (deduped across reviewers)

| ID | Severity | Source | Issue | Fix |
|---|---|---|---|---|
| **C1** | 🔴 UI | UI-3 | Desktop top nav has no `/journal` link (`app/layout.tsx:95-98`); BottomNav has it but desktop users can't reach it | Add `<NavLink href="/journal">Journal</NavLink>` |
| **H1** | 🟠 Code+Math | REVIEW-4 + MATH | `loadWeeklyStats(7)` filter is `>= today-7d` → 8-day window not 7 (`lib/journal/archive.ts:300-307`) | Tighten to `>` OR rename to `loadStatsForLastNDays(7)` with corrected math |
| **H2a** | 🟠 Code+Math | REVIEW-4 + MATH | `DerivedStats.expectancy` docstring says "Sum of winning $ minus sum of losing $" but actually computes per-trade R-expectancy (unitless) | Rewrite the docstring; consider renaming to `expectancyR` for clarity |
| **H2b** | 🟠 Code | REVIEW-4 | `r <= 0` in `computeRForTrade` means breakeven exits count as losses for winRate purposes (`lib/journal/archive.ts:230`) | Either change to `r < 0` for losses (breakeven excluded from win count but still in n) OR document the choice |
| **H3** | 🟠 Code | REVIEW-4 | `UpdateTradeInput = TradeBaseObject.partial()` has no superRefine. A closed→open edit persists stale `exit_date`/`exit_price`; table renders OPEN row with exit values (`lib/journal/schema.ts:90-92`) | Either add a refine to UpdateTradeInput or strip exit fields in updateTrade() when status flips to open |
| **C2** | 🔴 UI | UI-3 | Journal edit modal (`app/journal/journal-client.tsx:854-965`) is hand-rolled — no focus trap, no Escape close, no `aria-labelledby` | Replace with the existing `<Drawer>` component, which already implements all of this |
| **C3** | 🔴 UI | UI-3 (carry-over) | Symbol-page loading skeleton doesn't match the actual page layout — third time flagged | Rewrite `app/symbol/[ticker]/loading.tsx` to match the current v1.3.2 hero |
| M1 | 🟡 UI | UI-3 | Sector heat map cells truncate "Communication Services" with no tooltip | Add `title=` on hover (3 chars; trivial) |
| M2 | 🟡 UI | UI-3 | Macro strip VIX/10Y tone reads as "rising = bad" without explanation | Add a one-liner context tooltip |
| M3 | 🟡 Code | REVIEW-4 | `getMacroSnapshot()` awaited in root layout adds TTFB on every route | Either move out of root layout OR add a no-cache short-circuit when env unset |
| M4 | 🟡 UI | UI-3 (H4) | Journal mobile card uses `<button>` wrapping — blocks text selection / long-press | Convert to `<div role="button" tabIndex={0}>` with click + Enter handlers |
| M5 | 🟡 UI | UI-3 | Earnings chip + 4px progress bar duplicate info already in horizon badge | Keep chip, drop the 4px bar OR vice-versa — pick one |
| M6 | 🟡 UI | UI-3 (H5) | Sparkline 50×20 too small; line stroke wider than per-bar pitch | Bump to 70×24 OR drop entirely (the trend Badge already conveys direction) |
| L1 | 🟢 Code | REVIEW-4 | FRED `fetchSeries` reverses results assuming sort order without verifying | Sort observations by date before slicing |
| L2 | 🟢 Code | REVIEW-4 | Dev DELETE/PUT/POST are unauthenticated | OK for `127.0.0.1` but flag a comment to gate before public dev hosts |
| L3-L7 | 🟢 Code+UI | Various | Tracking-em zoo, skeleton color drift, `reason` on mobile hero, doc cleanup | Defer to v4.2 polish |

---

## 2. What I'm shipping in v4.1 (Tier 1 only)

Seven items, dispatched across three parallel `gsd-executor` agents on disjoint files.

### Agent A — code + math fixes (H1 + H2a + H2b + H3)
**Files:** `lib/journal/schema.ts`, `lib/journal/archive.ts`
**Effort:** ~45 minutes

- Fix `loadWeeklyStats` to a true 7-day window
- Rewrite `DerivedStats.expectancy` docstring to match the actual math
- Clarify the breakeven semantics in `computeRForTrade` (defaulting to `r < 0` for losses)
- Add `superRefine` to `UpdateTradeInput` so closed↔open transitions can't leave stale exit fields
- Also: strip exit fields in `updateTrade()` when status flips to open (belt-and-suspenders)

### Agent B — chrome fixes (C1 + C3)
**Files:** `app/layout.tsx`, `app/symbol/[ticker]/loading.tsx`
**Effort:** ~30 minutes

- Add `<NavLink href="/journal">Journal</NavLink>` to the desktop top nav
- Rewrite the symbol-page loading skeleton to match the current single-column hero (header + 4-up stat strip + chart + plan/thesis 2-col + context + gate breakdown)

### Agent C — modal a11y (C2)
**Files:** `app/journal/journal-client.tsx`
**Effort:** ~1 hour

- Replace the hand-rolled edit modal with the existing `<Drawer>` component (already implements focus trap, escape, `aria-labelledby`, prior-focus restore — verified at `components/Drawer.tsx:36-78`)
- Add-trade form (the collapsed inline form) stays inline; only the edit modal switches to Drawer

---

## 3. Deferred to v4.2 (after v4.1 stabilizes)

The Tier-2 medium polish items (M1 through M6 above):
- Sector heat map tooltips
- Macro strip tone explainer
- TTFB optimization on getMacroSnapshot
- Journal mobile card semantics
- Pick one of earnings-chip / progress-bar to remove
- Sparkline size or removal decision

Also deferred: all 5 Low items + the 3 Info items + Tier-3 pattern drift (tracking-em zoo, skeleton color drift, `reason` on mobile hero).

---

## 4. Verification (after all 3 agents commit)

1. `cd swing-trader-demo && npx tsc --noEmit` — clean
2. `npm run build` — clean
3. Smoke test on production after deploy:
   - Visit `/scanner` on desktop → "Journal" appears in top nav, clickable
   - Visit `/symbol/APLS` → skeleton matches the hero layout (no shape stutter)
   - Open `/journal`, click any trade row → Drawer-style edit panel slides in, Escape closes it, focus restores
   - POST a closed trade then PUT it back to open → exit fields are stripped server-side
   - Friday cron (next test trigger) → "Week in trades" reflects exactly 7 days

---

## 5. Out-the-door criteria

This patch ships when:
1. ✅ Three agent commits on `main`
2. ✅ tsc + build green
3. ✅ Each manual smoke test in §4 passes on production
4. ✅ No new regressions surfaced by a quick re-pass on prior REVIEW-* checklists

Then close the laptop. Reviewers can rotate to "are we ready for freeze?" pass.
