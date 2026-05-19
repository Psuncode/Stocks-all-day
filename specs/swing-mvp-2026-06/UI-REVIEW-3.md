# UI/UX audit — pass 3 (post-v4.0)

Reviewed: 2026-05-19
Reviewer: gsd-ui-auditor (read-only)
Scope: code-only. Mental viewports per request — iPhone SE (375×667) for the worst case, iPhone 14 (390×844) as the primary phone target, MacBook 13" (1280×800) for desktop. UI-REVIEW-2.md treated as the prior baseline; I only re-raise pass-2 findings when they were genuinely missed or regressed.

## Grades

| Pillar | Grade | Headline |
|---|---|---|
| 1. Accessibility | 2/4 | New journal edit modal is hand-rolled without focus trap, escape, or initial focus — a regression from the `Drawer` standard. BottomNav active-bar fix is in (good); 10px labels persist in journal + macro strip. |
| 2. Touch & Interaction | 3/4 | BottomNav now has a non-color active indicator. New scanner sortable headers are tiny click targets. Journal modal date/select inputs are native and full-width on mobile (good); the row-as-button on mobile blocks text selection on dates/notes (bad). |
| 3. Performance / loading | 3/4 | Journal `loading.tsx` matches its real layout reasonably (h-only diff). Symbol-page skeleton (C1 pass-2) still not rewritten. Sparklines are pure SVG and serverable — zero CLS risk. |
| 4. Style consistency | 2/4 | The brand is leaking color identity. v3.0 added an emerald-vs-rose heat map alongside the orange/emerald/rose toggle chips alongside emerald primary actions alongside red invalidation banners. Six distinct color systems in the scanner alone. Loading skeletons across pages still use three different bg neutrals. |
| 5. Layout & responsive | 3/4 | BottomNav at 5 tabs fits 320px but only just; "Watchlist"/"Settings" labels approach the cell width. Mobile journal cards are well-sized. Add-trade form's required row is unbalanced on phone (5 fields in a 2-col grid produces a dangling Status cell). Desktop top nav has NO Journal link — only mobile users can find /journal from chrome. |
| 6. Typography & color | 3/4 | tracking-[X] zoo from pass 2 (H5) explicitly not addressed — journal adds tracking-[0.3em], tracking-[0.24em], tracking-[0.2em], tracking-[0.18em] in a single page. Heat map and macro strip introduce yet more `text-[10px]` violations after BottomNav got bumped. |

Overall: **16/24** — same number as pass 2 but the failure profile has shifted from "mobile-flow broken" to "the new surface area is shipped without inheriting the patterns the team already paid for." The journal modal is the biggest single regression; everything else is incremental drift.

---

## Critical findings

### C1 — Desktop top-nav has no `/journal` link (Pillar 5)
`app/layout.tsx:95-98` declares the desktop chrome nav with four items: Scanner / Watchlist / Digest / Settings. The BottomNav (mobile) has five including Journal (`components/BottomNav.tsx:67-89`). On desktop the journal page is unreachable from the global chrome — the only paths are typing the URL or following a link from somewhere unstated. This is a discoverability bug, not a styling issue: shipping a primary feature without a chrome entry-point on the primary desk-trader surface makes the entire v4.0 work invisible to its target user.

**Fix:** Add `<NavLink href="/journal">Journal</NavLink>` at `layout.tsx:97` between Watchlist and Digest (mirror the BottomNav order). One line.

### C2 — Journal edit modal does not honor the project's own dialog patterns (Pillar 1)
`app/journal/journal-client.tsx:854-965` defines `EditModal`. Compared to the existing `components/Drawer.tsx` standard:

- No focus trap. Tab key wanders into the page behind.
- No escape-to-close handler. Backdrop click works (`:884`), escape does not.
- No initial focus restoration. Opening the modal does not focus the first input or the modal container; closing it does not return focus to the row that opened it.
- No `aria-labelledby` linking to the "Edit trade" heading. The modal has `role="dialog"` and `aria-modal="true"` but the heading at `:894-899` is unreferenced.

The Drawer at `components/Drawer.tsx:36-78` solves all four of these. Reinventing the dialog primitive 100 lines later, worse, is the kind of regression that's easy to ship and hard to notice — the modal "works" with a mouse, fails with a keyboard. Given that the user said "basic keyboard nav is enough," this falls short of even that bar: a keyboard user opening edit and pressing Escape gets nothing.

**Fix:** Replace `EditModal` with `<Drawer>` (it already supports arbitrary children and a `title`). If a modal-not-drawer feel is required, extract the focus-trap/escape logic from Drawer into a small `useModal()` hook and reuse. Either way, do not ship a second dialog primitive with worse a11y than the first.

### C3 — Symbol-page skeleton STILL does not match the v1.3.2 layout (Pillar 3)
Re-flagging from pass 2 C1. `app/symbol/[ticker]/loading.tsx` was supposed to be rewritten to mirror the hero / 4-stat / chart / plan+thesis layout. Two months later that hasn't happened. Every Slack → symbol navigation on desktop still produces a layout jump. Not user-facing data corruption, but it's the kind of detail that visibly cheapens the product.

**Fix:** Same as last time — re-do the skeleton against the actual page (`app/symbol/[ticker]/page.tsx:174-218` and the chart block following).

---

## High-severity findings

### H1 — Scanner sortable header click targets are sub-44pt (Pillar 2)
`app/scanner/scanner-client.tsx:1015-1045` renders each sortable column header as `<button>` inside a `<th className="border-b px-4 py-2">`. The button itself only carries the label text and an arrow — no padding of its own. At desktop typography (text-xs ≈ 12px), a label like "Vol" plus a 1ch arrow is roughly 40×16 px of click target. On a trackpad-driven workflow that's tolerable, but the choice signals "this isn't really meant to be tapped." On iPad mini (744×1133, where the `lg:` table breakpoint engages) this is touchable, and the target is sub-44pt.

**Fix:** Make the button itself the padded element — move `px-4 py-2` onto the button and drop it from the `<th>`. Same visual, 44pt tap zone on tablet.

### H2 — `text-[10px]` is back, in three new places (Pillar 6)
Pass 2 H1 bumped BottomNav from 10px → 11px. v3.0/v4.0 reintroduced 10px in:

- `app/journal/page.tsx:210` — StatCell label "Closed / Win rate / Avg R / Total $ P&L"
- `app/journal/journal-client.tsx:726` — every form field label ("Ticker", "Entry date", etc) in `Field`
- `components/SectorHeatMap.tsx:83` — ticker-count per sector
- `components/MacroStrip.tsx:60` and `:75` — VIX/10Y/Fed Funds label + the "5d" annotation

The stat strip labels are the worst — they're permanent UI on what's pitched as a personal dashboard. A user squinting at "Win rate" at 10px tracked uppercase to read the 18px value below it is exactly the legibility floor pass 2 said to avoid.

**Fix:** `text-[10px] → text-[11px]` everywhere, drop the tracking from 0.2em to 0.18em (matches what the form labels already do).

### H3 — Add-trade required-row dangles on phone (Pillar 5)
`app/journal/journal-client.tsx:566-619` declares the required row as `grid grid-cols-2 gap-3 sm:grid-cols-6`. On phone (<640px) we get a 2-col grid with 5 fields: Ticker, Entry date, Entry $, Shares, Status. That's 2 + 2 + 1 — Status sits alone in row 3 with empty space to its right. Visually unbalanced and (worse) it tells the user the form is bigger than it is, encouraging them to scroll for fields that don't exist.

If status flips to closed, two more fields drop in below as their own grid — so we go from "5 fields, dangle" to "5 fields, dangle, then exit-date+exit-price block." The whole closed-trade form on a 375px screen is ~360px tall before the "Add details" toggle even appears.

**Fix:** Reorder required row so the dangle is intentional — Ticker / Status (2-col first row, both are 1-cell), then Entry date / Entry $ (2-cell each = perfect 2-col on phone), then Shares alone last. Or: collapse Status into Ticker row with a smaller pill-style switch instead of a select, freeing one slot.

### H4 — Journal mobile cards are buttons that swallow text selection (Pillar 2)
`app/journal/journal-client.tsx:817-848` makes the entire mobile card a `<button type="button">`. Tap = open edit modal. There's no way for a user to long-press to select a date, copy a ticker, copy a $ figure, or share a row's exit price without going through the edit modal. On phone the journal is meant to be a *read* surface most of the time; the only mutation is "Mark closed" or "edit setup." Wrapping the read content in a button breaks the platform-native "select text to copy" pattern.

**Fix:** Make the card a `<div>` with an explicit Edit button in the corner (mirror the desktop pattern at `:792-803`). Or: keep the button but move the click handler to a small icon at the top-right rather than the entire card surface.

### H5 — Sparkline at 50×18 in desktop table row is too small to read (Pillar 4)
`app/scanner/scanner-client.tsx:887-891` renders the sparkline at 50×18 inside the Ticker cell's `flex items-center gap-2`, next to a hover-underline ticker link and a truncated sector string. 50 pixels wide for 30 closes means each daily bar is ~1.7px — narrower than the 1.25px stroke. The line ends up reading as a slightly tilted blur of color. The 56×20 mobile version (`:755-757`) is marginally better but still too small to convey shape.

The component is marked `aria-hidden="true"` (correct, it's decorative) but its job is to give a 2-second "is this trending up" cue, and at 50px wide that cue is just "the row's color tint is emerald or red" — a tint the row already has via `cardBg`/`rowBg`. The sparkline is doing zero work it isn't already doing.

**Fix:** Either go bigger (80×24 minimum to actually read shape) or drop the sparkline entirely on the desktop table where the trend Badge already encodes the same information. Mobile cards can keep a slightly larger version (72×24) since the row doesn't have a Trend cell.

---

## Medium-severity findings

### M1 — Sector heat map at 320px renders one large column, not two (Pillar 5)
`components/SectorHeatMap.tsx:68` declares `grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4`. With ~11 sectors typically returned at the MIN_TICKERS_PER_SECTOR=3 threshold, on a 320px iPhone SE Gen 1 viewport this produces a 2-col grid of cards roughly 140px wide. That's tight but readable. On the *389px-wide iPhone SE in landscape it actually renders fine.* The real failure is at 320px with the sector names — "Communication Services" truncates to "Communicatio…", which strips out which subsector it is. The tooltip on `title=` doesn't fire on touch.

**Fix:** Either abbreviate sectors (the Yahoo categories are wordy — "Tech" not "Technology", "Comms" not "Communication Services") or break the grid at >320px to 1-col and surface the full sector name. Don't rely on tooltips.

### M2 — Macro strip's "VIX UP = red" semantic is correct but the cell's tone-flip is opaque (Pillar 6)
`components/MacroStrip.tsx:92-104` passes `upIsBad` to the VIX and 10Y cells, which flips emerald/rose. Without surrounding context — and there is no helper copy — a desk trader sees "VIX 18.42 ↑ +1.10" rendered in *red* and has to mentally translate "the up-arrow means VIX rose, the red color means that's bad." Two layers of indirection. Most macro chyrons in the wild render rising VIX with neutral or amber + the directional arrow, leaving emerald/red for the *underlying asset's* relationship to user position.

**Fix:** Keep the up/down glyph but lock VIX and 10Y to amber/zinc, not emerald/rose. The current rendering reads as "risk-on bad, risk-off good" which is a worldview commitment the strip shouldn't be making.

### M3 — Sparkline + decision badge can collide in scanner mobile card (Pillar 5)
`app/scanner/scanner-client.tsx:752-759` puts the 56×20 sparkline next to a Badge inside a `flex items-center gap-2` that's the right-hand pane of a `flex items-start justify-between gap-2`. The left pane contains a `min-w-0` ticker block with a truncated sector+name underneath. At 375px the ticker block needs ~180px (ticker "TSLA" + 11px sector+name), the right pane carries (56 + 8 + ~80) ≈ 144px for Sparkline + gap + decision Badge "TRADE", plus the parent `gap-2`. 180 + 144 + 8 = 332 px — fits in the 343px inner width (after `p-4`), but only just. Decision badges with longer text ("WATCH") and longer sector names ("Communication Services · NVIDIA Corporation") will push the sparkline to wrap on a sub-iPhone-SE device (320px). Right now the visible failure is rare; it's a fuse waiting to blow on smaller phones or larger font scale.

**Fix:** Move the sparkline inside the left pane below the sector/name line, or constrain the sparkline width to `w-12` (48px) and accept the rounding loss.

### M4 — Three differently colored ToggleChip styles STILL present (Pillar 4)
Re-flagging pass 2 M1. `scanner-client.tsx:127-149` still defines orange / emerald / rose chip styles, and `:694-717` still uses them. Note: H5 from pass 2 (tracking value normalization) is also unaddressed. These are persistent style-consistency debts.

### M5 — Earnings chip + horizon badge can produce a 3-line badge row (Pillar 5)
`app/watchlist/_thesis-card.tsx:181-201` puts six possible items in a single `flex flex-wrap items-center gap-2`: setup tag, thesis-type, confidence dots pill, horizon badge, earnings chip, sometimes a "no data" badge in the header. The earnings chip's content is verbose — "📅 Earnings Aug 31 · in 4d" — at base text-xs that's about 130-140px. On a 375px card width with `p-4` (343 inner) the row wraps at three items minimum on most active watchlist cards, which pushes the price-progress strip 30-50px further down. Combined with the new 4px elapsed-bar at `:207-221`, the card vertical is creeping up.

**Fix:** On mobile, drop the "in 4d" suffix from the chip (the date alone communicates urgency). Or move the earnings chip into the horizon-badge row by replacing the horizon badge text wholesale when an earnings event falls inside the horizon (the EVENT-gate already considers this).

### M6 — Days-left progress bar at 4px is technically visible but reads as a 1px line (Pillar 4)
`app/watchlist/_thesis-card.tsx:208-220`. The bar is `h-1 w-full overflow-hidden rounded-full bg-zinc-100` with the fill being `h-full`. h-1 in Tailwind = 4px. On a phone the visual perception is 2-3px of fill above a 1px backdrop — readable but extremely thin. Combined with the existing price-progress bar at `:236-249` (`h-1.5`), the card now has *two* thin progress bars stacked 4px apart, which is too much UI for not enough information. The 4px elapsed bar adds visual furniture without communicating much that the horizon badge "(34d)" doesn't already.

**Fix:** Either bump elapsed bar to `h-1.5` matching the price bar, or drop it entirely on phone (the badge gives the same info numerically).

### M7 — Journal "Mark closed" button is in the modal header alongside "Edit trade" eyebrow (Pillar 6)
`app/journal/journal-client.tsx:901-910`. Visually the green emerald-50 pill "Mark closed" sits next to the small uppercase "Edit trade" eyebrow and the form's ticker headline. It looks like a tag, not an action. Users will scan and miss it. The destructive action (Delete) is at the bottom-left, which is the correct affordance pattern; the *constructive* action (Mark closed) should mirror — it belongs near Save, not in the header.

**Fix:** Move "Mark closed" into the bottom action row, just left of Save. Header becomes pure title.

### M8 — Modal backdrop is `bg-zinc-900/40 backdrop-blur` (Pillar 4)
`app/journal/journal-client.tsx:883`. The Drawer at `components/Drawer.tsx` uses `bg-zinc-950/30 backdrop-blur-sm`. The journal modal uses `bg-zinc-900/40 backdrop-blur`. Same role, two different recipes. The unblur tint feels lighter; the modal feels heavier. The whole point of using a shared dialog is to harmonize these.

### M9 — `MacroStrip` is server-rendered but only shows when `FRED_API_KEY` is set (Pillar 6, copywriting)
`components/MacroStrip.tsx:85` returns null when snapshot is null. There's no fallback copy, no "macro context unavailable" affordance. If the FRED endpoint is down on a given day, the strip silently vanishes and the user assumes the regime hasn't been updated. Not breaking, but the existing "Live data" green dot at `layout.tsx:110-111` makes a similar mistake — there's no honest "this feed is stale" signaling anywhere in the chrome.

### M10 — Loading skeletons use three different neutrals (Pillar 4 cohesion)
Re-flagging pass 2 M10. Journal loading uses `bg-zinc-200` and `bg-zinc-100`. Scanner loading uses `bg-zinc-200/80`. Watchlist loading uses `bg-white/60`. Three different "skeleton" tones in three pages.

---

## Low-severity findings

### L1 — Mobile journal cards have no setup label when setup is NONE (Pillar 6)
`app/journal/journal-client.tsx:744` returns an em-dash. On the desktop table it renders as a dim em-dash inline; on mobile cards it just floats next to the ticker as an em-dash with no surrounding label, which reads as "the ticker is em-dash." Use "—" inside a muted bracket like "(no setup)" on mobile, or hide entirely.

### L2 — Sortable header arrow is `↑` / `↓` text, not an icon (Pillar 4)
`scanner-client.tsx:1029`. Functional, but inconsistent with the inline glyph styles elsewhere (the heat map uses ↑/↓/·, the macro strip uses ↑/↓/·, the price chart uses ▲/▼). At a minimum the trend glyphs should standardize across these three. Right now you see two different arrow weights on the same page.

### L3 — Journal `Today` field default = today-iso (Pillar 6)
`journal-client.tsx:580` falls back to `today` if `form.entry_date` is empty. Good. But the `value` is a controlled input bound to the form, so the input's "Today" placeholder won't render — the field always shows the actual date string. That's fine functionally but means there's no visual hint of "you can change this." Add a subtle helper "default: today" below the field, or accept it as native-date behavior.

### L4 — Heat map "color clamped to ±5%" caption is buried (Pillar 6)
`SectorHeatMap.tsx:64-66`. The caption sits in the top-right corner of the panel at `text-[11px]` — and on mobile flex-wrap puts it on its own line below the title. Either move it into the title line as a `· (clamp ±5%)` suffix, or drop it (it's an implementation detail that adds noise).

### L5 — `useFreshForm` state is built with a stale closure on `today` (Pillar — bug, not UX, but it's in the journal client)
`journal-client.tsx:206` initializes `addForm` with `freshForm(today)`. After the date rolls over at midnight, this default never updates. Minor — only matters if a user keeps the tab open across midnight UTC. Worth a `useEffect` that resets `addForm.entry_date` when prop `today` changes.

### L6 — Journal stats strip "n=1" / "no R data" sub-labels (Pillar 6)
`page.tsx:152-157` and `:173-178`. Two sub-labels carry different meaning in the same slot: `n=N` and `no R data`. A user has to read both to know which state they're in. Standardize on one — either always show count, or always show qualitative state.

### L7 — Edit modal "Tap again to confirm delete" pattern (Pillar 6, copywriting)
`journal-client.tsx:939`. "Tap again to confirm delete" is fine on mobile, weird on desktop ("Tap" implies touch). Use "Click again to confirm" or, better, "Confirm delete" with a secondary cancel.

### L8 — Sparkline empty-state renders an empty SVG of full size (Pillar 4)
`components/Sparkline.tsx:30-41`. When `closes.length < 2` we return an empty SVG box of width×height. So a ticker without sparkline data takes up 50×20 of empty visual real estate, indistinguishable from one that "happens to be flat." Better: return a 1-stop dotted placeholder line or just `null` so the layout collapses cleanly.

### L9 — Heat map opacity-70 number text (Pillar 4)
`SectorHeatMap.tsx:83`. `opacity-70` on a `text-[10px]` ticker count drops the perceived contrast on the lighter shade tiles below 3:1. Use a tone variant (e.g. `text-emerald-700/80`) instead — opacity nukes contrast everywhere.

### L10 — Form labels at `text-[10px] tracking-[0.18em] uppercase` are the form's primary scaffolding (Pillar 6)
`journal-client.tsx:726`. Every field label in the journal form is at the smallest legible size. Bumping to 11px and dropping the uppercase entirely ("Ticker" not "TICKER") would feel less like a 2013 admin form and more like a journal.

---

## Journal-specific issues

The journal page mostly works. Specific issues that are journal-only:

1. **C2** edit modal a11y — biggest journal issue, repeated here.
2. **H3** required-row dangle — first impression of the form is "unbalanced."
3. **H4** entire mobile card as a button — text selection / native long-press broken.
4. **M7** "Mark closed" misplaced in modal header.
5. **L6** stats strip mixed sub-label semantics.
6. **L7** "Tap again" copy bias.
7. **Empty-state CTA correctness** (`journal-client.tsx:443-451`): when `addOpen` is true the "Log new trade" button in the empty state hides correctly — good. But the same button also hides from the action bar at the top because it changes to "Close." So the user toggling between empty state and "Log new trade" sees the CTA fire, the form open, no trade saved yet, and now the only path to dismiss is the "Close" button at top. Not a bug, but worth knowing the empty state's CTA disappears the moment a user thinks "I'll come back to this."
8. **`onMarkClosed` doesn't auto-focus the exit fields** (`journal-client.tsx:518-528`). After clicking Mark closed, the form silently grows two new fields below — but the modal doesn't scroll to them or focus the exit_date input. On a 375px screen the new fields are likely below the fold and the user thinks nothing happened.
9. **No keyboard shortcut to save** in the modal. Cmd+Enter or Enter-on-focused-input would feel native. Currently you must mouse to Save.
10. **`form.entry_date` and `exit_date` accept any past date** with no validation. A trade with exit_date earlier than entry_date passes client validation (`formToPayload` doesn't check ordering). The server may catch this but the UX should fail fast.

---

## Mobile-specific issues

1. **BottomNav at 5 tabs fits, but barely.** `max-w-md = 448px / 5 = 89px per tab` on devices that hit the cap; on 320-375px it's 64-75px. With h-14 (56px) icons at 22px and labels at 11px tracking-wide, "Watchlist" (9 chars) and "Settings" (8 chars) sit close to overflowing. Test on a 320px viewport — labels will not wrap, they'll truncate or push the cells uneven. Acceptable now, fragile if a tab name grows.
2. **Symbol-page hero `reason` still renders on mobile** (`app/symbol/[ticker]/page.tsx:198-200`). Pass 2 H4 said to drop the reason on phone; the refactor made the hero stack better but still includes the reason. The string is up to 60 chars at `text-sm`, which wraps to 2-3 lines under the decision badge.
3. **Journal modal at 375px** — works, but the form is dense enough that the Save button is below the fold after opening "Add details." The user has to scroll just to see Save.
4. **Scanner sparkline + decision badge layout** can collide on sub-iPhone-SE devices (M3).
5. **Mobile journal cards block text selection** (H4).
6. **Sector heat map at 320px truncates long sector names** without a touch-friendly tooltip (M1).
7. **The price-progress + days-elapsed bar stack on watchlist cards is now 4px + 6px (h-1 + h-1.5)** with 4px of gap. On a phone that's 14px of "thin bar" UI that reads as visual noise.
8. **Add-trade button + Reset button + Save button** all stack vertically in the form footer (`journal-client.tsx:413-433`) once `flex-wrap` kicks in below 375px. Visually fine, but the order is Cancel-on-the-left, Save-on-the-right, which is correct desktop, *inverted* on iOS (where primary action goes top/right in dialogs). Minor.

---

## What's working well

1. **Sparkline component is correct and stateless.** Pure SVG, `aria-hidden="true"`, server-renderable. Even though the size is too small (H5), the implementation is clean and the color logic is honest (no fake intensity for flat data).
2. **Sector heat map's clamped color scale is principled.** ±5% clamp with five buckets is genuinely thoughtful — extreme outliers don't drown out the sector signal, and the buckets are large enough to actually perceive differences. Compare with most heat maps which use a linear gradient and end up looking like one giant blob of emerald.
3. **Journal stats strip is honest about missing data.** "no R data" / "needs stop or thesis" sub-labels (`page.tsx:154,176`) — most personal tools fake a zero. This one tells you when a metric is degenerate.
4. **Optimistic mutations with revert.** `journal-client.tsx:265-340` shows real care — local state updates immediately, server confirms or reverts, error messaging is inline. This is the right shape.
5. **BottomNav active-bar fix** (`components/BottomNav.tsx:138-143`) shipped exactly as pass 2 H2 recommended. 2px emerald bar above the active tab + label color delta = redundant cue that survives grayscale.
6. **Macro strip degrades silently** when `FRED_API_KEY` is unset (`components/MacroStrip.tsx:85`). The chrome stays clean and the rest of the page is unaffected. Good failure mode.
7. **Journal API + KV-unavailable empty state.** `app/journal/page.tsx:41-58` doesn't crash, doesn't render a half-broken page — it just tells you the backend isn't configured and points at KV-SETUP.md. The watchlist already does this; consistency is the right call.

---

## Recommended fix order

Block 1 — keyboard + discoverability (45 minutes):
- **C1** Add Journal link to desktop top nav (`layout.tsx:97`).
- **C2** Replace `EditModal` with `<Drawer>`, or add focus trap + escape handler.
- **H4** Make mobile journal cards `<div>` + corner edit button.

Block 2 — chrome consistency (1-2 hours):
- **H2** `text-[10px] → text-[11px]` everywhere in journal page, journal form, heat map, macro strip.
- **H5** Either bump sparkline size or remove from desktop table.
- **C3** Rewrite symbol-page skeleton.
- **M2** Lock VIX/10Y macro cells to amber tone, leave emerald/rose for the underlying.
- **M10** Standardize loading skeleton bg neutral.

Block 3 — journal polish (1 hour):
- **H3** Reorder add-trade required row to avoid the dangle.
- **M7** Move "Mark closed" to the modal footer.
- **L6** Pick one stats-strip sub-label semantic.
- **L7** Replace "Tap again" with a desktop-neutral phrasing.

Block 4 — density + drift (1-2 hours):
- **M3** Constrain or relocate the scanner mobile sparkline.
- **M4** Normalize ToggleChip color (carry-over from pass 2 M1).
- **H5** from pass 2 — `tracking-[X]` normalization, still owed.
- **M5/M6** Earnings chip + thin bar stack on watchlist cards.
- **L8** Sparkline empty-state should collapse cleanly.

Out of scope (deferred):
- Dark mode.
- Animation beyond transition-colors.
- i18n.
- Full a11y audit of all dialogs (start with the journal modal, then sweep).

---

## Files audited

`app/layout.tsx` · `app/manifest.ts` · `app/journal/page.tsx` · `app/journal/journal-client.tsx` · `app/journal/loading.tsx`
`app/scanner/page.tsx` · `app/scanner/scanner-client.tsx`
`app/symbol/[ticker]/page.tsx` · `app/symbol/[ticker]/loading.tsx` (re-check only)
`app/watchlist/_thesis-card.tsx`
`components/BottomNav.tsx` · `components/Sparkline.tsx` · `components/SectorHeatMap.tsx` · `components/MacroStrip.tsx` · `components/Drawer.tsx` (for comparison)
`public/` (icon inventory check)

Screenshots: not captured (no dev server in this audit session). Spatial reasoning against documented viewports: iPhone SE 375×667, iPhone 14 390×844, iPad mini 744×1133, MacBook 13" 1280×800. A confirming live pass on the journal edit modal and the scanner table on iPad mini is recommended for the H1 / H4 / H5 calls.
