# PLAN-v2.1 — Audit response

**Source:** comprehensive UI audit performed against `trader.psunproduction.com` (pre-v2.0 snapshot)
**Created:** 2026-05-19
**Ships:** before `2026-06-17` freeze window
**Status:** ready to execute

---

## Scope

The audit produced 7 findings. Two are already resolved by v2.0 and need no action:

| Audit finding | Resolution |
|---|---|
| **Auth pre-fill: "Jamie Collins / atlasfund.com"** (Low) | `/login` route + `lib/demo-auth.ts` + `UserStatus` deleted in v2.0-pre (`45d714e`) |
| **Symbol page: "Add to watchlist requires YAML"** (Medium) | One-tap Watch button shipped in v2.0-F (`f0da6d7`); page hint can now mention it |

The remaining 5 findings + 1 stale copy reference are below. Each task is independently shippable; the whole batch is ~1 evening.

---

## Tasks

### T1 — Reconcile "live data" vs "mock data" copy (audit H1)

**Audit said:** Settings page reads *"This demo uses mock market data"* while header shows *"Live data."* Contradictory.

**Current state (verified at `app/settings/page.tsx:69`):** Already says *"Uses live Yahoo Finance data via yahoo-finance2 (no key required)"* — fixed in v1.10. The audit was captured pre-v1.10.

**Action:** Verify only — confirm no remaining "mock" / "demo" copy across `app/`. Sweep + remove if found. Estimated effort: 5 minutes.

**Acceptance:**
- [ ] `grep -i "mock market\|demo data" app/ specs/` returns nothing
- [ ] Settings header strip and any other status copy says "Live Yahoo Finance" or equivalent

---

### T2 — Scanner cold-load progress indication (audit M1)

**Audit said:** Scanner sits at "Scanning universe…" for 10–15s with no progress feedback. Users wonder if it's frozen.

**Cause:** `/api/scan` makes a full sweep through ~600 symbols via Yahoo Finance. On cold start there's no per-symbol cache hit so the time is real.

**Action:** Add an animated dot indicator + an elapsed-seconds counter + a friendly progress message that updates ("Fetching universe… / Evaluating 600 tickers… / Almost there…") on rough timing milestones. No real progress events from the backend yet — we fake it with elapsed-time heuristics, which is enough for the UX gap.

**Files:**
- `app/scanner/scanner-client.tsx` — extend the existing loading state with `elapsedSec` and a progress label.

**Acceptance:**
- [ ] On cold load, scanner shows an animated indicator + elapsed time and a message that changes at ~3s, ~8s, ~15s milestones
- [ ] Hot-cache loads (warm) still feel snappy; no fake delay
- [ ] `npx tsc --noEmit` clean

**Effort:** 30 minutes.

---

### T3 — Symbol page hint when ticker not in watchlist (audit M2)

**Audit said:** When `/symbol/[TICKER]` is loaded for a ticker not in the watchlist, the page hints *"Add it in `data/watchlist.yaml` to attach a thesis…"* — developer-centric UX.

**Current state (`app/symbol/[ticker]/page.tsx:386-403`):** Still mentions `data/watchlist.yaml`. v2.0-F shipped the one-tap Watch button on `/scanner` but didn't add it to `/symbol`.

**Action:** Two parts:
1. Update the hint copy to point at the scanner's Watch button as the primary path, mention YAML as the advanced/persistent path.
2. *(Stretch)* Add a Watch button on the symbol page itself so the user doesn't have to navigate back to the scanner. Client component that calls `/api/watch` with the current ticker's metadata.

**Files:**
- `app/symbol/[ticker]/page.tsx` — update the "Not on watchlist" copy block.
- *(Stretch)* New `app/symbol/[ticker]/watch-button-client.tsx` for the symbol-page Watch toggle.

**Acceptance:**
- [ ] Hint no longer mentions YAML editing as the primary path
- [ ] *(Stretch)* Symbol page has a Watch toggle that round-trips through `/api/watch`
- [ ] `npx tsc --noEmit` clean

**Effort:** 30 min (copy only) / 1.5 hr (with stretch button).

---

### T4 — Gemini button disabled when API key unset (audit M3)

**Audit said:** Gemini [EXPLAIN] button is active even when `GEMINI_API_KEY` is not configured. Click → silent failure.

**Current state (`app/symbol/[ticker]/gemini-explain.tsx:80`):** Button only disabled during `loading`. No env-aware disable.

**Cause:** The client component doesn't know about env vars. Need to either:
- Pass a `geminiEnabled` boolean from the server component, OR
- Have the API return a clear "not_configured" response and surface it in UI

Option A is cleaner. Add a prop and a parent fetch.

**Files:**
- `app/symbol/[ticker]/page.tsx` — read `process.env.GEMINI_API_KEY` server-side, pass `geminiEnabled` prop to `GeminiExplain`.
- `app/symbol/[ticker]/gemini-explain.tsx` — accept `geminiEnabled`; when false, disable button + show tooltip "Enable Gemini in Settings".

**Acceptance:**
- [ ] On a deploy without `GEMINI_API_KEY`, `/symbol/<TICKER>` shows the Gemini panel with a disabled button and a tooltip
- [ ] On a deploy with `GEMINI_API_KEY` set, behavior unchanged
- [ ] `npx tsc --noEmit` clean

**Effort:** 20 minutes.

---

### T5 — Thesis card shows drop_reason for shelved entries (audit L1)

**Audit said:** PTRN listed as "Shelved" with text "No thesis yet" — confusing.

**Current state (`app/watchlist/_thesis-card.tsx:179`):**

```ts
{entry.notes ?? "No thesis yet."}
```

PTRN has `dropped_reason` populated but no `notes` and no `thesis` block, so the card falls through to the "No thesis yet" placeholder, ignoring the drop reason that's actually in the YAML.

**Action:** Change the fallback chain so that for `status: shelved | dropped | exited`, the card shows `dropped_reason` (or "Shelved without a reason captured" if missing). For non-thesis-active entries, prefer drop reason → notes → "No thesis yet" in that order.

**Files:**
- `app/watchlist/_thesis-card.tsx` — extend the notes fallback logic.

**Acceptance:**
- [ ] PTRN card displays its drop reason inline ("Fundamentals strong but momentum chase + insider selling overhang + untested setup. Outside my edge.")
- [ ] An entry with status `shelved` and no drop reason shows "Shelved without a reason captured"
- [ ] An entry with `notes` but no `dropped_reason` still shows the notes
- [ ] `npx tsc --noEmit` clean

**Effort:** 15 minutes.

---

### T6 — Add sector_tag to OWLT (audit L2)

**Audit said:** OWLT in the watchlist YAML has no sector/category tag — inconsistent with ANGX/PACS/SMR.

**Current state (`data/watchlist.yaml:50-54`):**

```yaml
- ticker: OWLT
  name: Owlet
  status: dropped
  dropped_at: 2026-05-18
  dropped_reason: "..."
```

Confirmed: no `sector_tag`. PTRN also lacks one.

**Action:** Add `sector_tag` to both OWLT (consumer) and PTRN (consumer or industrials — depends on actual classification; consumer is fine for both).

**Files:**
- `data/watchlist.yaml`

**Acceptance:**
- [ ] OWLT entry has `sector_tag: consumer`
- [ ] PTRN entry has `sector_tag: consumer`
- [ ] YAML still parses without schema errors

**Effort:** 2 minutes.

---

### T7 — Sweep "demo" / "this demo" copy (audit drift)

**Audit observed remnants of "demo" framing.** v1.10 cleaned the most visible offenders but other strings may remain.

**Action:** grep for `"demo"`, `"Demo"`, `"This demo"`, `"this demo"` across `app/` and update any user-visible copy. Keep references in commit messages / spec docs / READMEs.

**Files:** any in `app/` that match.

**Acceptance:**
- [ ] `grep -r "this demo\|This demo" app/` returns nothing user-visible
- [ ] Code comments and spec doc references unchanged

**Effort:** 10 minutes.

---

## Out of scope (deferred or already done)

| Item | Status |
|---|---|
| Login pre-fill cleanup | ✅ resolved in v2.0-pre (login killed) |
| YAML-only watchlist edit | ✅ resolved in v2.0-F (Watch button) |
| Scanner full-perf overhaul | Deferred — separate phase. v1.9 sector RS memoization already cut the worst path; further work needs streaming responses or pre-warmed caches |
| Symbol-page Watch button (stretch from T3) | Optional — judge after T3 copy fix lands |
| Settings page rework (audit didn't flag) | Out of scope of this plan |

---

## Critical path & shipping order

```
T1 (verify)  ─┐
T6 (YAML)   ──┼─► one commit "v2.1 audit response (T1+T5+T6+T7)"
T5 (thesis) ──┤
T7 (sweep)  ──┘

T4 (gemini)  ─► one commit "v2.1 gemini-aware button"
T2 (scanner) ─► one commit "v2.1 scanner progress UX"
T3 (symbol)  ─► one commit "v2.1 symbol-page watch hint"  (+ stretch button as separate commit)
```

Three (or four with the stretch) atomic commits. Total wall-clock ~1.5 hours.

---

## Verification checklist (before declaring v2.1 done)

- [ ] `npx tsc --noEmit` clean across all changes
- [ ] `data/watchlist.yaml` still schema-valid (loadWatchlist returns no errors)
- [ ] Production deploy renders without console errors
- [ ] Visiting `/symbol/<random-ticker-not-in-watchlist>` shows the new hint
- [ ] Visiting `/symbol/<watchlist-ticker>` unchanged
- [ ] Scanner cold-load shows the progress milestones
- [ ] Gemini button disabled state visible when env var unset
- [ ] No "this demo" or "mock data" strings remain in user-visible UI

---

## Risks

| Risk | Mitigation |
|---|---|
| Scanner progress milestones drift from reality | Numbers are heuristic, not real progress. Tune via observation if user reports a deploy that's faster/slower than the milestones suggest. |
| Symbol-page Watch button (stretch) hits hydration mismatch | Keep client component thin; pass minimal props; reuse the existing scanner toggle pattern. |
| PTRN/OWLT `sector_tag` is a guess | "Consumer" is a defensible default; user can override in vault. |
