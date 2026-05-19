# PLAN-v4.0 — Trade journal MVP

**Source decisions:**
- Strategic feedback (2026-05-18): *"Decision journal — the long-term edge. The only feature here that no off-the-shelf tool replicates."*
- Research report (`DATA-SOURCES-RESEARCH.md`, 2026-05-19): *"The engine's biggest unlock isn't another data source — it's the trade journal."*
- KV persistence layer just shipped (v3.0-E digest archive + v3.0-F quick-watch). Same pattern reusable here.

**Created:** 2026-05-19
**Target ship:** before 2026-06-17 Inara freeze (4 weeks)
**Estimated effort:** 5-7 evenings across 5 tasks
**Mode:** vertical MVP slice (UI → API → KV storage in one cut, then per-feature)

---

## 1. Problem statement

Right now the engine evaluates ~600 names daily, the digest archives forward returns of its picks, the watchlist tracks theses with invalidations. **What's missing: what the user actually did.**

When the user takes a trade — entry, sizing, what setup it was for, what thesis they followed — that data goes nowhere. It lives in their brokerage UI, in screenshots, in mental notes. Six months from now there's no answer to:

- "When I trade `oversold_bounce` setups, what's my actual win rate?"
- "Do I size up correctly on TRADE-rated picks vs WATCH-rated picks?"
- "How does my average R compare to the engine's projected R:R?"
- "Which thesis-type (catalyst vs technical) am I best at executing?"

A trade journal answers all of these from one structured store. The engine's value-add scales linearly with how much the user trusts it; trust scales with measured outcomes.

## 2. Scope (MVP — what ships before freeze)

### What's IN
- KV-backed trade record store, schema-validated via zod (mirrors `lib/thesis/schema.ts` pattern)
- Per-trade fields: ticker, side, entry/exit dates+prices, setup tag, thesis reference (optional), notes, status (open/closed)
- Auto-computed fields: $ P&L, R-multiple (if invalidation price is on the linked thesis OR explicit risk price field)
- `POST/GET/PUT/DELETE /api/journal` endpoints
- `/journal` UI: log-new-trade form + history table + small stats strip (win rate, average R, expectancy, n)
- By-setup breakdown panel (P&L + win rate per setup type)
- Weekly Friday Slack digest with the journal's stats summary

### What's OUT
- Multi-leg / options
- Short positions (out of scope for v4.0; can be added later — schema supports `side: "short"` but UI is long-only)
- Brokerage integration (no Robinhood/Schwab API)
- Screenshot upload
- Position-level P&L over time (no time-series store)
- Multi-user

### What's DELIBERATELY DEFERRED to post-freeze
- "Lessons learned" auto-generation via Gemini after each closed trade (powerful but adds AI dependency to a critical-path workflow)
- Pre-trade checklist enforcement (good but adds friction; ship after we know the actual journal is being used)
- Calibration tables (e.g. "your gut on TRADE setups predicts P&L with r=0.42") — needs n≥30 trades first

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    /journal page (SSR)                          │
│  - history table (rows = trades, columns = ticker/setup/R/P&L)  │
│  - stats strip (win rate, avg R, expectancy)                    │
│  - by-setup breakdown                                           │
└────────────────────┬────────────────────────────────────────────┘
                     │ uses
                     ▼
        lib/journal/archive.ts (server)
        - listTrades(limit?)
        - addTrade(record)
        - updateTrade(id, patch)
        - removeTrade(id)
        - computeStats(trades)
                     │ uses
                     ▼
              lib/data/kv.ts (existing)
                     │
                     ▼
              Upstash Redis
              journal:set       (SET of trade IDs, sortable by ULID timestamp prefix)
              journal:<ULID>    (JSON record per trade)

┌─────────────────────────────────────────────────────────────────┐
│  POST   /api/journal          add a trade                       │
│  GET    /api/journal          list (last 100 by default)        │
│  PUT    /api/journal?id=X     update                            │
│  DELETE /api/journal?id=X     delete                            │
└─────────────────────────────────────────────────────────────────┘

Client-side (in /journal page client component):
- Inline form to add trade (collapsed by default, expanded on tap)
- Edit modal triggered from row click
- Optimistic updates with revert-on-failure
```

## 4. Data model

```ts
// lib/journal/schema.ts (new)
import { z } from "zod";
import { SetupTag } from "@/lib/types";

export const TradeSide = z.enum(["long", "short"]); // short out-of-scope for v4 UI but schema-supported

export const TradeStatus = z.enum(["open", "closed"]);

export const TradeRecord = z.object({
  id: z.string(),                       // ULID — lexically sortable by creation time
  ticker: z.string().regex(/^[A-Z0-9.\-]+$/),
  side: TradeSide.default("long"),
  status: TradeStatus,
  // Entry side
  entry_date: z.string(),               // ISO YYYY-MM-DD
  entry_price: z.number().positive(),
  shares: z.number().positive(),
  setup_at_entry: SetupTag.optional(),
  // Risk (one of three sources)
  stop_price: z.number().positive().optional(),  // explicit
  // OR linked thesis
  watchlist_thesis_ticker: z.string().optional(), // if set, use the YAML thesis's invalidation_price
  // Exit side (null while open)
  exit_date: z.string().optional(),
  exit_price: z.number().positive().optional(),
  // User-supplied
  notes: z.string().optional(),
  // Metadata
  created_at: z.string(),               // ISO timestamp
  updated_at: z.string(),
}).superRefine((r, ctx) => {
  if (r.status === "closed") {
    if (!r.exit_date) ctx.addIssue({ code: "custom", message: "closed trades need exit_date", path: ["exit_date"] });
    if (!r.exit_price) ctx.addIssue({ code: "custom", message: "closed trades need exit_price", path: ["exit_price"] });
  }
});

export type TradeRecord = z.infer<typeof TradeRecord>;
```

Derived stats (computed at read time, not stored):

```ts
export type DerivedStats = {
  n: number;
  closedN: number;
  winRate: number;        // closed-trades only
  avgR: number;           // R-multiple, average across closed trades with a stop_price/invalidation
  expectancy: number;     // winRate × avgWin − (1-winRate) × avgLoss
  totalPnL: number;       // sum of (exit-entry)*shares for closed
  bySetup: Record<SetupTag, { n: number; winRate: number; avgR: number }>;
};
```

R-multiple calculation:
```
risk_per_share = entry_price - stop_price (long); reverse for short
R = (exit_price - entry_price) / risk_per_share
If stop_price is null but watchlist_thesis_ticker is set, use that thesis's invalidation_price.
If neither, R is null and that trade is excluded from avgR.
```

## 5. Tasks (5 tasks, 3 parallel agents after foundation)

### T1 — Foundation: schema + storage + zod loader (1 evening, blocking)
- `lib/journal/schema.ts` (new) — TradeRecord + DerivedStats types per §4
- `lib/journal/archive.ts` (new) — KV-backed CRUD + computeStats(). ULID generation via `ulid` npm package OR a tiny custom monotonic-timestamp+random fn (avoid the dep).
- Failure-soft: when KV is unavailable, all functions return safe empty defaults (matches digest-archive pattern from v2.0-E).
- Unit-of-correctness: `computeStats([])` returns zeros without crashing. `addTrade()` produces a record that `listTrades()` returns.

**Files (new):**
- `lib/journal/schema.ts`
- `lib/journal/archive.ts`

**Acceptance:**
- [ ] `npx tsc --noEmit` clean
- [ ] Manually round-trip an add → list → update → list → delete via a throwaway script (delete the script before commit)
- [ ] Stats computation matches hand-calc on 3 trades (1 win, 1 loss, 1 open)

**Effort:** 1 evening (~90 min)
**Depends on:** nothing (KV is already live)

### T2 — API routes (1 evening) — parallel after T1
- `app/api/journal/route.ts` — GET (list), POST (add), PUT (update via ?id=), DELETE (remove via ?id=)
- Reuse the `CRON_SECRET`-style header gating ONLY for DELETE; GET/POST/PUT are gated by the existing Vercel demo-auth or just open (single-user tool)
- Validation errors return 400 with the zod issue array
- KV outage returns 503 with `{ ok: false, reason: "kv_unavailable" }`

**Files (new):**
- `app/api/journal/route.ts`

**Acceptance:**
- [ ] `npx tsc --noEmit` clean
- [ ] Curl POST a sample trade → 200 with record returned
- [ ] Curl GET → list contains the trade
- [ ] Curl PUT with patch → updated
- [ ] Curl DELETE → removed; subsequent GET doesn't show it

**Depends on:** T1

### T3 — `/journal` page UI: history + stats (2 evenings) — parallel after T1
- Server component reads from `lib/journal/archive.ts`
- Renders:
  - Stats strip at top (win rate, avg R, expectancy, n) — same pattern as `/digest`
  - History table (mobile: card grid). Columns: ticker, setup, entry/exit, R, P&L, status (open/closed badge)
  - By-setup breakdown panel below
  - "Log new trade" button → client component modal

**Files (new):**
- `app/journal/page.tsx` (server component)
- `app/journal/loading.tsx` (skeleton)
- `app/journal/journal-client.tsx` (client — the add-trade modal + edit row)

**Acceptance:**
- [ ] Empty state renders cleanly
- [ ] After T2 lands and one trade is POSTed via curl, page shows it
- [ ] Mobile (375px) cards render readably
- [ ] Click row → modal opens with edit form
- [ ] BottomNav adds a "Journal" tab (replacing or alongside the current 4)

**Depends on:** T1 (for schema types); can develop UI shell against mock data while T2 wires up the real API

### T4 — Friday Slack digest extension (1 evening) — parallel after T1
- Extend the cron `app/api/check-invalidations/route.ts` to ALSO compute journal stats and include them in the Friday Slack message
- On Mon-Thu the digest is unchanged (invalidations + top-5 picks)
- On Fri the digest adds a "📓 Week in trades" section: n closed this week, win rate, total P&L, by-setup quick breakdown

**Files modified:**
- `app/api/check-invalidations/route.ts`
- `lib/thesis/slack.ts` (extend Block Kit builder for journal section)

**Acceptance:**
- [ ] Manually trigger the cron on a Friday and inspect the Slack message
- [ ] On non-Fridays the section is absent
- [ ] Failure-soft: if journal stats computation fails, the rest of the digest still delivers

**Depends on:** T1

### T5 — Slack ingest: log-trade-via-Slack-message (1 evening, optional stretch) — after T2
**Stretch.** Lets the user log a trade from their phone via Slack DM to the same channel the digest goes to. Pattern: a slash command `/trade BUY APLS 100 @ 41.50 stop 39.80 setup base_breakout`. Parses, validates, POSTs to `/api/journal`, replies with a confirmation.

**Files (new):**
- `app/api/slack/command/route.ts` — Slack slash command handler
- Slack app config update (user does this in Slack dashboard, ~5 min)

**Acceptance:**
- [ ] `/trade` command in Slack creates a journal entry visible on `/journal`
- [ ] Invalid syntax replies with the expected format
- [ ] Slack signing verification works (X-Slack-Signature header check)

**Depends on:** T2

---

## 6. Execution plan — agent team

After this plan is approved, dispatch **after T1 lands**:

| Agent | Tasks | Files (disjoint) |
|---|---|---|
| **A** | T2 (API routes) | `app/api/journal/*` |
| **B** | T3 (page UI) | `app/journal/*`, `components/BottomNav.tsx` |
| **C** | T4 (Slack Friday section) | `app/api/check-invalidations/*`, `lib/thesis/slack.ts` |

T1 I'll do solo (foundation, all three depend on it).

T5 is optional stretch — judge after T2/T3/T4 land.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Schema sprawl (user wants more fields later) | Ship MVP fields exactly per §4. Resist additions until the user actually asks. |
| ULID dep is overkill | Use a tiny inline `Date.now().toString(36) + randomHex(8)` — no dep needed |
| Add-trade form friction kills usage | Two-line form for the common case (ticker + entry_price); everything else is optional and collapsed |
| Journal becomes write-only (people log, never review) | Make `/journal` the home page on the Slack Friday digest — the act of opening Slack auto-reminds |
| KV cost overrun | Free tier 30k cmd/month covers ~1000 trades/month easily |
| Slack slash command security (T5) | Verify HMAC signing using SLACK_SIGNING_SECRET; reject unsigned requests |

## 8. Out-of-scope, reaffirmed

- Brokerage API (Robinhood, Schwab, Tradier, Alpaca) — manual entry only
- Multi-leg / options
- Position-level intraday P&L
- Tax-lot tracking
- Calibration analytics (post-freeze, needs n≥30 trades)
- "Lessons learned" Gemini auto-summary
- Screenshot uploads

## 9. Verification checklist (before declaring v4.0 done)

- [ ] `npx tsc --noEmit` clean across all changes
- [ ] Vercel build green (with `--webpack` per current package.json)
- [ ] `/journal` renders on production
- [ ] Round-trip a real trade: log it via UI → see it in stats → close it → R-multiple updates correctly
- [ ] On Friday after cron runs, Slack message includes the "Week in trades" section
- [ ] No KV cost spike (check Vercel/Upstash dashboard after 7 days)

## 10. Out-the-door criteria

This phase is complete when, with no further dev intervention:

1. ✅ All 4 atomic commits on `main` and deployed
2. ✅ User has logged 1 real trade and viewed it
3. ✅ Stats panel shows non-zero numbers
4. ✅ Friday Slack message includes the journal section
5. ✅ Pre-existing features (scanner, digest, watchlist) still work — no regressions

After (1)-(5), close the laptop. Freeze through 2026-08-17. The journal accumulates real data automatically while you're at Inara.
