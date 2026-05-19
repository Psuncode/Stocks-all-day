# UI/UX audit — pass 2 (post-v1.10)

Reviewed: 2026-05-19
Reviewer: gsd-ui-auditor (read-only)
Scope: code-only audit (no live screenshots). Live URL `https://trader.psunproduction.com` referenced for spatial reasoning; iPhone 14 (390×844) and iPhone SE (375×667) used as the mental viewports.

## Grades

| Pillar | Grade | Headline |
|---|---|---|
| 1. Accessibility | 3/4 | Focus-visible global, drawer trap, aria-labels in place — but bottom-nav active state relies on color alone and the 10px labels are below WCAG-friendly minimum. |
| 2. Touch & Interaction | 2/4 | BottomNav tabs hit 56px, but inline 4×4 checkboxes, 24px chips, and recharts dot tooltips all violate the 44pt minimum on mobile. |
| 3. Performance / loading | 3/4 | All three `loading.tsx` files exist; scanner skeleton matches its real layout poorly; symbol skeleton matches an OLD two-column layout (regression from v1.3.2 redesign). |
| 4. Style consistency | 3/4 | Strong glass/cream visual identity, consistent 28px radii, good badge system. Three accent-orange/emerald/rose ToggleChip styles muddy the brand palette. |
| 5. Layout & responsive | 2/4 | Mobile-first generally, but the scanner's filter `<aside>` and the desktop status strip have specific mobile failures, and the symbol page header wraps badly at 375px. |
| 6. Typography & color | 3/4 | Tabular-nums applied to numeric data. Hierarchy is fine. Heavy reliance on text-[10px] / text-[11px] / tracking-[0.2em] uppercase as the de-facto secondary typography — risky for older eyes and high cognitive load. |

Overall: **16/24** — solid but mobile interaction targets and a few layout regressions need attention before this is the daily-driver phone surface.

---

## Critical findings (by pillar)

### C1 — Symbol-page skeleton no longer matches the page it loads (Pillar 3)
`app/symbol/[ticker]/loading.tsx:21` declares `lg:grid-cols-[1.35fr_0.65fr]` with a tall left column and two stacked right cards. The actual symbol page at `app/symbol/[ticker]/page.tsx:200-218` is now a **full-width hero chart** followed by a 2-col `Plan + Thesis` grid (`page.tsx:221`). The skeleton-to-content swap will visibly jump on every navigation from Slack → symbol page on desktop, and the mobile skeleton heights (`h-[360px]` + two `h-48`) don't correspond to the actual mobile order (header → 4-cell stat grid → chart → plan card → thesis card → context → gates → Gemini), so phone users see a stutter too. This is a v1.3.2 regression that was missed.

**Fix:** Rewrite `symbol/[ticker]/loading.tsx` to mirror the new layout: hero header, 2×2 stat grid (mobile) / 1×4 (desktop), full-width chart skeleton, then 1-col (mobile) / 2-col (desktop) plan+thesis skeleton.

### C2 — PWA manifest references PNG icons that don't exist (Pillar 3, install-time UX)
`app/manifest.ts:21-29` declares `/icon-192.png` and `/icon-512.png`, but `public/` contains only `icon.svg`. iOS Safari's "Add to Home Screen" path doesn't honor SVG-only icons reliably on older iOS versions (16 and below render a screenshot fallback). On the first install attempt the user will get a faded fallback icon and no maskable variant, undercutting the "this is a real app" feeling the PWA work is trying to create.

**Fix:** Either (a) ship pre-rendered 192/512 PNG (and a 180×180 apple-touch-icon) generated from `public/icon.svg`, or (b) remove the PNG entries from `manifest.ts` and add `<link rel="apple-touch-icon">` pointing at an actual PNG. The SVG itself is fine (`public/icon.svg` is centered and viewbox-correct), it's the manifest pointing at vapor that's the issue.

### C3 — Scanner sidebar collapses into a 280-row block above results on mobile (Pillar 5)
`app/scanner/scanner-client.tsx:345` declares `grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]`. On phone width the Filters card (`scanner-client.tsx:346-412`) renders **above** the results, pushing the actual data list ~280–340px below the fold. On a 390×844 iPhone 14 with the slim header eating ~56px and the bottom nav reserving 80px (`pb-20` at `layout.tsx:118`), the user has roughly 700px of vertical space and the entire first screen is filters — not a single result is visible until they scroll. The product's primary mobile use case is "Slack says X just hit; tap to scanner, see the row" — that workflow is broken.

**Fix:** On mobile, collapse Filters into a `<details>` summary or a sticky-top "Filters · 2 active" chip that opens a Drawer (the Drawer component already exists). The chip-strip (setup + 3W/Utah/Healthcare) at `scanner-client.tsx:463-523` is the only filter UI 90% of mobile sessions need.

---

## High-severity findings

### H1 — BottomNav labels are 10px, semi-bold, tracked (Pillar 1, 6)
`components/BottomNav.tsx:95` sets the tab label to `text-[10px] font-semibold tracking-wide`. WCAG SC 1.4.4 doesn't mandate a minimum, but iOS HIG and Material Design both target ~11px floor for tab-bar labels with good contrast; 10px tracked text in `text-zinc-500` (idle) is below the practical legibility floor for users >40 in real daylight. Active-state `text-emerald-900` is fine; idle `text-zinc-600` on `bg-white/95` clears 4.5:1 but barely.

**Fix:** Bump to `text-[11px]` or drop the tracking utility — at 10px the letter-spacing makes "Scanner" / "Watchlist" look reedy.

### H2 — BottomNav active state is color + stroke-width only (Pillar 1)
`components/BottomNav.tsx:18-21` toggles `strokeWidth={active ? 2.2 : 1.7}` and label color `emerald-900` vs `zinc-600`. There's no shape change, no underline, no pill background — colorblind (deuteranopia common in men) users get only the slight stroke-weight delta and a slightly darker label. Apply a top accent bar or a soft pill background under the active tab. WCAG 1.4.1 (use of color) is technically violated since the difference is conveyed mostly by color.

**Fix:** Add a 2px top border or a 32px wide `h-1` accent bar above the active tab icon (`bg-emerald-700`).

### H3 — 4×4 checkbox + 4×4 select tap targets in scanner sidebar (Pillar 2)
`scanner-client.tsx:355`, `:363`, `:374` are bare `<input type="checkbox" className="h-4 w-4">`. That's 16×16 CSS px — even with the parent `<label>` extending the hit area horizontally, the *visual* affordance is far below 44pt and the row gap (`space-y-3`) doesn't quite give the 44pt rule of thumb. Native iOS will render this small enough that fat-finger mis-taps on the "Allow earnings trades" toggle could change risk posture without the user noticing. On the desktop view (which is where the sidebar lives once C3 is fixed) this is acceptable, but if you keep any of these on mobile, swap to a proper toggle component.

**Fix:** Either keep the sidebar desktop-only (preferred — see C3) or replace the `h-4 w-4` checkboxes with `h-5 w-5` and ensure the `<label>` has `py-3` to extend the hit zone.

### H4 — Symbol page hero on 375px: ticker + name + decision badge + reason all on one row, wraps to four lines (Pillar 5)
`app/symbol/[ticker]/page.tsx:161-185` opens with `flex flex-wrap items-end justify-between`. At 375px the right block (`Badge + result.reason`) regularly contains a 60-char `reason` string ("Pullback above SMA50 in healthcare, RS okay but vol soft"). That string at base `text-sm` will wrap to 2-3 lines, and the surrounding `flex-wrap items-end` baseline-aligns them against the 4xl ticker, producing a lopsided header that looks like a layout bug. Combined with the price + today's % move + sector line below, the hero eats 180-220px before the user sees a chart.

**Fix:** On mobile, drop `result.reason` from the hero (it's repeated verbatim in the gate breakdown anyway). Keep just `Badge tone={decision}` next to the ticker. Move the reason string to the "Why this decision" card's intro line.

### H5 — `tracking-[0.2em]` / `tracking-[0.24em]` / `tracking-[0.28em]` / `tracking-[0.3em]` mixed indiscriminately (Pillar 4, 6)
Grep across `app/` shows tracking values 0.2 (most), 0.22, 0.24, 0.28, 0.3 used semi-randomly for uppercase eyebrow labels — same role, different visual weight. Examples:
- `layout.tsx:64` 0.24em
- `login/page.tsx:23` 0.3em, `login/page.tsx:99` 0.28em, `login/page.tsx:115` 0.24em
- `scanner-client.tsx:347` 0.24em, `:447` 0.2em
- `symbol/[ticker]/page.tsx:447` 0.2em, `:348` 0.2em
- `watchlist/page.tsx:119` 0.3em
- `UserStatus.tsx:36` 0.2em, `:47` 0.2em

The eye reads these as "almost the same but not quite," which is exactly what design-system rot looks like.

**Fix:** Pick one — 0.22em or 0.24em — and rip-and-replace. Add a Tailwind `tracking-eyebrow` token if needed.

---

## Medium-severity findings

### M1 — Three differently-colored ToggleChip styles fragment the accent palette (Pillar 4)
`scanner-client.tsx:88-111` declares orange / emerald / rose variants for the 3W / Utah / Healthcare chips. Plus the setup-filter row uses `bg-emerald-900` for active. That's four distinct chip palettes in a single horizontal row at `:463-523`. The chips already differ semantically by their emoji prefix — the multi-color treatment is decorative, not functional, and it dilutes emerald as the brand accent. Pick a single chip style (emerald-on-white) and let the emoji + count carry identity.

### M2 — Setup-filter row wraps to 2-3 lines on phone (Pillar 5)
6 setup chips + a separator + 3 toggle chips = 10 elements at `:463`. At 375px with `gap-2` and emoji-padded labels ("🌀 3W momentum", "🏔️ Utah", "❤️ Healthcare"), `flex-wrap` will produce a 3-row chip strip eating ~140px. The separator at `:498` (`h-5 w-px bg-zinc-200`) lands mid-wrap and visually orphans whichever chips end up after it. Either move the three toggle chips into a secondary "More filters" row, or drop the visual separator (it's redundant once the chips are styled distinctly).

### M3 — Scanner mobile card: 5 gate badges + decision badge + reason + plan all rendered for every row (Pillar 4, density)
`scanner-client.tsx:541-624` shows ~10 distinct visual elements per row. With ~600 universe symbols (mostly PASS), even 50 filtered cards is 500 badges visible. The decision color cue (`cardBg` at `:37`) already does the gross "is this interesting" signal. For PASS rows specifically, consider collapsing the gate badge strip behind "Show gates" so the PASS sea is just `ticker · sector · reason · [Explain]` and TRADE/WATCH rows get the full treatment. Right now every row is the same density.

### M4 — Recharts default tooltip is non-touch-friendly (Pillar 2)
`PriceChart.tsx:56-69` uses default Recharts hover tooltip — there's no `trigger="click"` or touch handling, so on mobile the only way to read a specific date's close is a tap-and-hold that fires hover state inconsistently. The whole chart is read-only on phones. Either disable the tooltip on touch devices, or wrap the chart in a custom `<Crosshair>` that fires on touchstart.

### M5 — Login page still uses "your swing desk" / "ticker workspaces" copy that hints at multi-user / desk product (Pillar 1, copywriting)
`app/login/page.tsx:25` "Sign in to your swing desk" and `:128` "CapIQ-ready ticker workspaces" + `:140` "Team-ready views". The v1.10 cleanup removed demo cruft from the FORM, but the aside copy is still ghost-product B2B-team marketing that doesn't match a personal-tool product. Either rewrite the aside as "What this tool does for me" with three real bullets (Slack digest / thesis tracking / invalidation alerts) or drop the aside entirely.

### M6 — `UserStatus` and Sign In CTA persist next to slim mobile wordmark (Pillar 5)
`layout.tsx:98` always renders `<UserStatus />` in the header. On mobile (390px), the slim wordmark + Sign In pill + 16px padding consumes the entire header row. There's no real auth — this is theatre. Hide the UserStatus block on `md:` and below; the BottomNav doesn't include a profile tab, so removing it from mobile costs nothing.

### M7 — Drawer width `max-w-xl` is fine on desktop, full-width on mobile, but doesn't have a swipe-down dismiss (Pillar 2)
`Drawer.tsx:103` `w-full max-w-xl translate-x-0`. On phone, the drawer fills the whole viewport but the only way out is the "Close" text button (`Drawer.tsx:118`) in the top-right or backdrop tap. Native iOS users expect a top edge gesture. Not a blocker — but adding a `h-1 w-12 rounded-full bg-zinc-300` "grabber" affordance at the top reads as more native.

### M8 — Symbol page "Toggle" link to flip earningsAllowed is a tiny text link buried in helper copy (Pillar 2)
`symbol/[ticker]/page.tsx:261-266` puts `Toggle` as a `text-emerald-800` text-link inside the helper copy. The control is doing significant work — flipping it changes whether the page shows a plan at all — but it's styled like a footnote. On mobile the link tap target is ~50×16. Promote to a real toggle/switch component or at minimum a pill button.

### M9 — Watchlist mobile cards: 7+ badges in a row above progress bar (Pillar 4)
`_thesis-card.tsx:127-142` can render `setup tag` + `thesis type` + `ConfidenceDots` + `horizon`, plus the header row above (`:104-113`) carries ticker + name + sector_tag + optional "no data". Combined with the fire banner (when present), an "INVALIDATED" card is 4 stacked sections of dense info. The product is right to make invalidations loud — but the routine "active, watching N rules" card carries too much typographic furniture. Consider hiding `thesis_type` and `sector_tag` behind a tap-to-expand.

### M10 — Loading skeletons hardcode `bg-zinc-200/80` / `bg-white/60` (Pillar 4 cohesion)
Scanner loading uses `bg-zinc-200/80`; watchlist loading uses `bg-white/60`; symbol loading uses `bg-zinc-200/80` for text and `bg-white/70` for cards. They feel different. Standardize on one neutral (`bg-white/60` on the cream background is the closest match to live content).

---

## Low-severity findings

### L1 — Stat strip label sizes (Pillar 6)
`symbol/[ticker]/page.tsx:447` `text-[10px] uppercase tracking-[0.2em]`. Below ergonomic floor. Bump to `text-[11px]` and trim tracking to 0.18em.

### L2 — `Explain` button on scanner row (Pillar 4, copywriting)
`scanner-client.tsx:620` "Explain" is the same verb as the symbol page's Gemini button (`gemini-explain.tsx:83`) which fires an LLM call, but the scanner button just opens a Drawer with rule-based gate breakdown — no Gemini. Two affordances with identical wording, different behavior. Rename the scanner one to "Why?" or "Gate detail".

### L3 — `Sign In` pill in header has 2px ring of `border-emerald-200` against pale emerald bg — contrast ~3.1:1 on the border (Pillar 1)
`UserStatus.tsx:25`. Border is decorative, not informational, so contrast is acceptable, but combined with a 12px `tracking-[0.2em]` uppercase label inside an emerald-on-emerald pill it's harder to read than the equivalent `Continue as guest` plain button.

### L4 — Top-of-page status strip on desktop says "Live data" with a green dot but is purely cosmetic (Pillar 4)
`layout.tsx:103-115`. The dot isn't tied to actual data freshness. If the daily Slack/cron fails, this dot still shows green. Either wire it to last-cron-timestamp or remove the strip.

### L5 — Body copy uses three different muted greys (Pillar 6)
`text-zinc-500`, `text-zinc-600`, `text-zinc-700` all show up as "secondary text." That's fine in principle, but the same hierarchy slot (e.g., card subtitle) flips between zinc-500 and zinc-600 across files. Convert one to a `var(--ink-muted)` (already declared in `globals.css:8`) and prune.

### L6 — Watchlist "Watching N rules" expansion has tiny font-mono rule IDs (`text-[10px]`) (Pillar 6)
`_thesis-card.tsx:205`. The rule ID is debug info; bury it behind a long-press or remove on mobile.

### L7 — Scanner page subtitle `$5–$100 · ADV$ ≥ $10M · spread ≤ 0.25%` (Pillar 1, info architecture)
`app/scanner/page.tsx:11`. These are the *engine* filter thresholds, not toggleable user filters. Useful but presented as if it's actionable context. Tiny: prefix with "Universe:" to clarify it's hard-coded.

### L8 — `Wordmark` icon background is `bg-emerald-950` (`layout.tsx:47`) but the manifest theme color is `#1e6f5c` (`--accent`) — visually different greens (Pillar 4)
The dark mark color is fine for the icon, but if you ever do a "press to home" animation that uses theme color as the splash background, you'll see a flash between the dark-emerald-950 tile and the lighter accent. Not breaking, just inconsistent.

### L9 — `app/login/page.tsx` aside section width on tablet (Pillar 5)
`grid-cols-[1.05fr_0.95fr]` at `lg:` only. Between 768px and 1024px the form and aside stack with the aside dominating the fold. Move the `lg:` to `md:` or set the aside to `md:max-w-md` when stacked.

### L10 — `ConfidenceDots` is implemented twice with subtly different markup (Pillar 4)
`app/symbol/[ticker]/page.tsx:32-41` and `app/watchlist/_thesis-card.tsx:45-57`. Same UX role, different a11y labels, different unicode escapes. Extract to `components/ConfidenceDots.tsx`.

---

## Mobile-specific issues

1. **Scanner is unusable above the fold on mobile (C3)** — the Filters sidebar pushes results off-screen. This is the biggest single mobile failure in the audit.
2. **Symbol page hero wraps badly at 375px (H4)** — ticker / name / decision / reason all on one wrapping flex row produces an unbalanced 4-line header before the chart loads.
3. **Bottom-nav labels are 10px (H1)** — readable in a perfect lighting test, marginal in direct sun.
4. **Setup-filter chips wrap to 3 rows on iPhone SE (M2)** — 10 chips at base-12 with emoji padding doesn't fit.
5. **PWA install icon will fall back on iOS 16 (C2)** — no PNG, no apple-touch-icon.
6. **Chart tooltip is hover-only (M4)** — chart effectively read-only on touch.
7. **`pb-20 md:pb-0` (`layout.tsx:118`) wrapper is fine for scrolling content, but the BottomNav's `env(safe-area-inset-bottom)` (`BottomNav.tsx:75`) is applied to `paddingBottom` of the nav itself — content above won't honor it.** On iPhones with home-indicator (X and later) the nav lifts correctly, but if any page renders a sticky-bottom action button (none today, but the pattern is risky as the app grows) the home indicator and the action will collide.

---

## What's working well

1. **Universal focus-visible** (`globals.css:74-79`) — accent-colored 2px outline with 2px offset and reduced-motion respect is a strong baseline almost no SaaS gets right.
2. **Drawer is a real dialog** — `aria-modal`, focus trap (`Drawer.tsx:52-78`), escape-to-close, prior focus restoration (`:36-49`). This is genuinely accessible work and shows up nowhere else in the app, so it stands out.
3. **Badge component carries semantic icons inside the pill** (`Badge.tsx:7-100`) — the check/triangle/dash glyphs mean colorblind users get a redundant cue. Apply this same thinking to BottomNav (see H2).
4. **YAML-backed watchlist is honest about state** — fire banners are loud, error banners are explicit, "no thesis yet" empty state is honest. Most personal tools fudge these.

---

## Recommended fix order

Block 1 — broken mobile flow (1 evening):
- **C3** Scanner sidebar → details/drawer on mobile.
- **H4** Symbol hero: drop reason on mobile, keep ticker + decision.
- **C1** Rewrite `symbol/[ticker]/loading.tsx` to match the v1.3.2 layout.

Block 2 — install polish (1 hour):
- **C2** Ship `/public/icon-192.png` + `/icon-512.png` + apple-touch-icon, or trim manifest.
- **H1, L1** Bump 10px text to 11px in BottomNav + stat labels.

Block 3 — chrome cleanup (2 hours):
- **H2** BottomNav active state — add accent bar or pill bg.
- **H5** Normalize uppercase tracking values to one token.
- **M5** Rewrite login aside or delete it.
- **M6** Hide UserStatus on mobile header.

Block 4 — density and polish (2-3 hours):
- **M1** Collapse ToggleChip colors to one emerald style.
- **M2** Two-row chip strip on mobile, or move toggles into a "More" expander.
- **M3** PASS rows render collapsed by default on mobile.
- **M4** Touch-friendly chart tooltip.
- **L2** Rename scanner "Explain" → "Why?".
- **L10** Extract `ConfidenceDots`.

Out of scope for this pass (logged but not actionable yet):
- Dark mode (CSS vars in `globals.css:3-13` exist but no toggle).
- Animations beyond Tailwind transitions.
- i18n / RTL.

---

## Files audited

`app/layout.tsx` · `app/page.tsx` · `app/manifest.ts` · `app/globals.css`
`app/scanner/page.tsx` · `app/scanner/scanner-client.tsx` · `app/scanner/loading.tsx`
`app/symbol/[ticker]/page.tsx` · `app/symbol/[ticker]/loading.tsx` · `app/symbol/[ticker]/gemini-explain.tsx`
`app/watchlist/page.tsx` · `app/watchlist/watchlist-client.tsx` · `app/watchlist/_thesis-card.tsx` · `app/watchlist/loading.tsx`
`app/login/page.tsx` · `app/settings/page.tsx`
`components/BottomNav.tsx` · `components/Badge.tsx` · `components/Drawer.tsx` · `components/GateBreakdown.tsx` · `components/PriceChart.tsx` · `components/NavLink.tsx` · `components/UserStatus.tsx`
`public/icon.svg`

Screenshots: not captured (no dev server in this audit session). All findings are sourced from code; spatial reasoning against the documented viewports. A follow-up live pass on the iPhone 14 / SE viewports is recommended for confirming H1, H4, M2, and M4.
