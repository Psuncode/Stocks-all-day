# PLAN-v4.4 — Slack digest: one pick per day

**Date:** 2026-05-19
**Brief:** Reduce daily Slack message from top-5 ranked picks to exactly one. Always surface something — TRADE if possible, WATCH if not, best of full ranked universe (could be PASS) as final fallback. Web archive (`/digest/{date}`) keeps the 5-pick semantics untouched.

**Source:** verbal design + user approval ("yes"), 2026-05-19. No new requirements line added — this is a delivery-shape change on existing Feature D.

---

## 1. Scope

**Files changed:**
- `lib/digest/build.ts` — extract sort comparator; widen return to `{ picks: DigestPick[]; topPick: DigestPick | null }`. `topPick` is `allRanked[0]` regardless of tier; `picks` keeps existing TRADE+WATCH filter + slice 5.
- `app/api/check-invalidations/route.ts` — destructure `{ picks, topPick }`; pass `topPick` (not `picks`) to `sendSlackDigest`. `picks` continues to flow into `persistDigest` for the web archive.
- `lib/thesis/slack.ts` — `sendSlackDigest` signature changes from `picks: DigestPick[]` to `topPick: DigestPick | null`. `pickBlocks` renders exactly one pick, header reads "📊 Today's pick". When `topPick.decision !== "TRADE"`, prepend a one-line context message ("No TRADE today — closest WATCH below" / "No TRADE or WATCH — best-ranked candidate is currently PASS").

**Files NOT touched:** the engine, scanner UI, watchlist, journal, FRED, Finnhub. This is a Slack-delivery-only change.

**Estimated effort:** ~45 min, single agent, three commits or one — I'll do one.

---

## 2. Decision details

| Branch | topPick.decision | Slack context line |
|---|---|---|
| ≥1 TRADE | `TRADE` | none — go straight to the pick |
| 0 TRADE, ≥1 WATCH | `WATCH` | `_No TRADE today — closest WATCH below._` |
| 0 TRADE, 0 WATCH | `PASS` | `_No TRADE or WATCH today — best-ranked candidate is PASS. Honest "stand down" with full context below._` |

The decision badge in the pick row already shows TRADE/WATCH/PASS truthfully (see `decisionTag()` — currently only handles TRADE+WATCH, will extend to PASS too).

**Sort comparator** — extracted to a named exported helper `compareForDigest(a, b)`. Three-tier decision order: `TRADE(0) < WATCH(1) < PASS(2)`. Remaining tiebreakers unchanged: `sustainedHighVol` → user preference (Utah / healthcare) → R:R desc → ADV$ desc.

---

## 3. Verification

1. `npx tsc --noEmit` clean
2. `npm run lint` clean
3. `npm run build` clean
4. Local smoke: manually invoke the cron path in dev with no Slack key (just read the log → "Would have sent 0 fire(s) + N pick(s)" — confirm N = 1) OR temporarily route the build to a test channel.
5. Production smoke (post-deploy): trigger the cron via curl, eyeball Slack:
   ```bash
   curl -X POST https://trader.psunproduction.com/api/check-invalidations \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Confirm: header reads "Today's pick", exactly one pick block, no "Today's 5".

---

## 4. Commit message

```
slack(v4.4): one pick per day — always surface exactly one ticker

Replace the top-5 Slack digest with a single-pick message. Fallback
chain when the engine has no TRADE candidates: best WATCH → best of
full ranked universe (may be PASS). Web /digest archive keeps the
5-pick semantics untouched. Decision badge in the pick row tells the
truth (TRADE / WATCH / PASS) — context line above explains stand-down
days so they feel deliberate, not broken.
```

---

## 5. Out-the-door

1. ✅ tsc + lint + build green
2. ✅ One commit on `main`
3. ✅ Pushed to origin
4. ⏸️ User confirms Slack message shape on next 21:05 UTC cron, or by manually triggering the cron via the curl above
