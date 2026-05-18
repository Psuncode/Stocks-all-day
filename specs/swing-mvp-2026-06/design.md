# Design — Swing MVP 2026-06

**Implements:** `requirements.md` v1.1 (2026-05-18)
**Author:** Philip Sun
**Created:** 2026-05-18

This document specifies the technical shape of the MVP. Reading order: §1 architecture → §2 file layout → §3 data model → §4 validator → §5 API → §6 dedup → §7 Slack → §8 UI → §9 migration → §10 open questions.

---

## 1. Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│                       Vercel Cron (16:05 ET)                       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ POST
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│            /api/check-invalidations (route handler)                │
│                                                                    │
│  1. Read data/watchlist.yaml → parse → validate (zod)              │
│  2. For each active ticker: fetch candles (lib/data/provider)      │
│  3. Evaluate invalidation_rules (lib/thesis/evaluate-rules)        │
│  4. Apply dedup window via candle history (no state file)          │
│  5. If any non-suppressed fire → POST Slack webhook                │
│  6. Return JSON summary                                            │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ▼
                  Slack DM / channel (one message)

Browser-facing surface (read path):
┌────────────────────────────────────────────────────────────────────┐
│  /watchlist (server component)                                     │
│    → reads YAML at request time                                    │
│    → evaluates rules + price progress + horizon state              │
│    → renders cards (mobile) / table (desktop)                      │
│    → shows fires prominently when present                          │
│                                                                    │
│  /symbol/[ticker]                                                  │
│    → if ticker is in watchlist with thesis: render thesis panel    │
│    → show stop_price vs invalidation_price both labeled            │
│    → show setup-tag-mismatch warning if user tag ≠ engine setup    │
│    → show suggested-shares hint                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Key design choice — no fire-store file.** Dedup is a pure function of market data: if `price_below: $2.30` is fired, suppression checks whether any of the last 7 daily closes hit ≤ $2.30. This eliminates a persistence concern, works on Vercel's ephemeral filesystem, and survives deploys without state migration. See §6.

---

## 2. File layout

New files only — existing engine, components, and pages already exist:

```
swing-trader-demo/
├── data/
│   ├── watchlist.yaml         ← committed; edited via vault sync (A.1.1)
│   └── .gitignore             ← protects any future local-only state
├── lib/
│   ├── thesis/
│   │   ├── schema.ts          ← zod schemas; mirrors §3 types
│   │   ├── load.ts            ← read + parse + validate YAML; returns Watchlist
│   │   ├── evaluate-rules.ts  ← rule evaluator + dedup logic (§6)
│   │   ├── horizon.ts         ← time_horizon → state (computed, not stored)
│   │   ├── sizing.ts          ← suggested-shares helper (B.6.1)
│   │   └── slack.ts           ← Block Kit payload builder + fetch POST
│   └── types-thesis.ts        ← exported TS types (derived from zod schemas)
├── app/
│   ├── api/
│   │   ├── check-invalidations/
│   │   │   └── route.ts       ← cron entrypoint (§5.1)
│   │   └── watchlist/
│   │       └── route.ts       ← GET — server reads YAML (§5.2)
│   ├── watchlist/
│   │   ├── page.tsx           ← now a server component (was client)
│   │   └── watchlist-client.tsx ← updated: receives initial data via props,
│   │                                drops localStorage, adds thesis cards
│   └── symbol/[ticker]/
│       └── page.tsx           ← extended with thesis panel + sizing hint
├── vercel.json                ← cron config (§5.3)
└── specs/swing-mvp-2026-06/
    ├── requirements.md
    ├── research.md
    ├── design.md              ← this file
    └── tasks.md               ← next deliverable
```

---

## 3. Data model

TypeScript types are derived from zod schemas (single source of truth). Schema file: `lib/thesis/schema.ts`.

```ts
import { z } from "zod";

export const SetupTag = z.enum([
  "pullback", "base_breakout", "squeeze", "oversold_bounce", "none",
]);

export const ThesisType = z.enum(["technical", "catalyst", "mixed"]);

export const TickerStatus = z.enum([
  "active", "research_pending", "shelved", "dropped", "exited",
]);

const PriceRule = z.object({
  id: z.string(),
  description: z.string().optional(),
  signal: z.enum(["price_below", "price_above"]),
  level: z.number().positive(),
});

const RsiRule = z.object({
  id: z.string(),
  description: z.string().optional(),
  signal: z.enum(["rsi_above", "rsi_below"]),
  period: z.number().int().positive().default(14),
  level: z.number().min(0).max(100),
});

const VolumeRule = z.object({
  id: z.string(),
  description: z.string().optional(),
  signal: z.literal("volume_spike"),
  multiple: z.number().positive().default(3),
});

const NewsRule = z.object({
  id: z.string(),
  description: z.string().optional(),
  signal: z.literal("news_match"),
  pattern: z.string(), // regex string, evaluator is v1 stub
});

export const InvalidationRule = z.discriminatedUnion("signal", [
  PriceRule.extend({ signal: z.literal("price_below") }),
  PriceRule.extend({ signal: z.literal("price_above") }),
  RsiRule.extend({ signal: z.literal("rsi_above") }),
  RsiRule.extend({ signal: z.literal("rsi_below") }),
  VolumeRule,
  NewsRule,
]);

export const Thesis = z.object({
  summary: z.string(),
  thesis_type: ThesisType,
  setup_tag: SetupTag.optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  entry_target: z.number().positive(),
  exit_target: z.number().positive(),
  invalidation_price: z.number().positive(),
  time_horizon: z.string().refine(s => !isNaN(Date.parse(s)), "ISO date"),
  catalysts: z.array(z.string()).default([]),
});

export const TickerEntry = z.object({
  ticker: z.string().regex(/^[A-Z0-9.\-]+$/),
  name: z.string().optional(),
  status: TickerStatus,
  sector_tag: z.string().optional(),
  thesis: Thesis.optional(),
  invalidation_rules: z.array(InvalidationRule).default([]),
  sizing: z.object({
    position_pct: z.number().min(0).max(100).optional(),
    notes: z.string().optional(),
  }).optional(),
  history: z.array(z.object({
    date: z.string(),
    result: z.string(),
    setup_tag: SetupTag.optional(),
    spy_trend_on_exit: z.enum(["up", "down", "chop"]).optional(),
  })).default([]),
  obsidian_link: z.string().optional(),
  notes: z.string().optional(),
  dropped_at: z.string().optional(),
  dropped_reason: z.string().optional(),
}).superRefine((entry, ctx) => {
  // A.2.2: enforce thesis-type / invalidation-type matching
  if (!entry.thesis) return;
  const allowed = ALLOWED_SIGNALS_BY_TYPE[entry.thesis.thesis_type];
  for (const [i, rule] of entry.invalidation_rules.entries()) {
    if (!allowed.has(rule.signal)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["invalidation_rules", i, "signal"],
        message: `Signal "${rule.signal}" not allowed for thesis_type "${entry.thesis.thesis_type}". See §B.5.`,
      });
    }
  }
  // Required-iff: dropped/exited need dropped_at + dropped_reason
  if ((entry.status === "dropped" || entry.status === "exited")
      && (!entry.dropped_at || !entry.dropped_reason)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "dropped/exited tickers require dropped_at and dropped_reason",
    });
  }
});

export const Watchlist = z.object({
  version: z.literal(1),
  risk_pct: z.number().min(0).max(100).default(0.5),
  tickers: z.array(TickerEntry).default([]),
});

export type Watchlist = z.infer<typeof Watchlist>;
export type TickerEntry = z.infer<typeof TickerEntry>;
export type Thesis = z.infer<typeof Thesis>;
export type InvalidationRule = z.infer<typeof InvalidationRule>;
```

---

## 4. Validator — type-matching table (B.5)

```ts
const ALLOWED_SIGNALS_BY_TYPE: Record<z.infer<typeof ThesisType>, Set<string>> = {
  technical: new Set(["price_below", "price_above", "rsi_above", "rsi_below", "volume_spike"]),
  catalyst:  new Set(["news_match"]),
  mixed:     new Set(["price_below", "price_above", "rsi_above", "rsi_below", "volume_spike", "news_match"]),
};
```

Validation runs once at load time in `lib/thesis/load.ts`:

```ts
export async function loadWatchlist(): Promise<{
  watchlist: Watchlist;
  errors: ZodIssue[];
}> {
  const yamlText = await fs.readFile(WATCHLIST_PATH, "utf-8");
  const raw = yaml.load(yamlText);
  const result = Watchlist.safeParse(raw);
  if (!result.success) {
    return { watchlist: { version: 1, risk_pct: 0.5, tickers: [] }, errors: result.error.issues };
  }
  return { watchlist: result.data, errors: [] };
}
```

Per A.3.4: invalid ticker entries are skipped, not fatal. Implement via second-pass filter on validated tickers (parse top-level first, then each `TickerEntry` individually with separate `safeParse` calls; collect failures into the `errors` array). The single-pass `superRefine` above is the strict version — split into two passes if granular reporting matters; v1 uses single-pass and surfaces all errors at once.

---

## 5. API surface

### 5.1 `POST /api/check-invalidations` (cron entrypoint)

```ts
// app/api/check-invalidations/route.ts
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Auth: Vercel Cron sets Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { watchlist, errors } = await loadWatchlist();
  const active = watchlist.tickers.filter(t => t.status === "active");

  const provider = getProvider();
  const fires: FireRecord[] = [];
  for (const entry of active) {
    const symbol = await provider.getSymbol(entry.ticker);
    if (!symbol) continue; // B.3.5: skip when no data
    for (const rule of entry.invalidation_rules) {
      const evaluation = evaluateRule(rule, symbol.candles);
      if (evaluation.fired && !evaluation.suppressed) {
        fires.push({ ticker: entry.ticker, rule, evaluation, thesis: entry.thesis });
      }
    }
  }

  if (fires.length > 0) {
    await sendSlackDigest(fires); // §7
  }

  return Response.json({
    checked: active.length,
    fires: fires.length,
    schema_errors: errors,
    timestamp: new Date().toISOString(),
  });
}
```

### 5.2 `GET /api/watchlist` (UI read path)

Optional — `/watchlist` page reads YAML directly via the server component. This route exists only if any client-side refresh-without-reload is needed. **v1 decision: skip this route. Server component reads YAML on every request.** Adds one file but removes a moving part.

### 5.3 `vercel.json` — cron config

```json
{
  "crons": [
    {
      "path": "/api/check-invalidations",
      "schedule": "5 21 * * 1-5"
    }
  ]
}
```

- Time: 21:05 UTC = 16:05 America/New_York during EST (winter). During EDT (summer), this becomes 17:05 — acceptable; market close + 1hr is still post-session. Acceptable v1 imprecision. Alternative: two cron entries, one per timezone half-year — overkill.
- Mon–Fri only (`1-5`).
- Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically if `CRON_SECRET` env var is set in the project.

---

## 6. Dedup — stateless via candle history

Spec C.3 originally proposed a `fires.json` store. **Replaced with stateless dedup.** Each rule type's suppression check reads daily candles, not a state file:

| Rule signal | Fire condition | Suppression check (look back 7 trading days) |
|---|---|---|
| `price_below` | `last_close ≤ level` | Any close in last 7 sessions ≤ level → suppress |
| `price_above` | `last_close ≥ level` | Any close in last 7 sessions ≥ level → suppress |
| `rsi_above` | `rsi14(closes) ≥ level` | Any of last 7 daily RSI14 values ≥ level → suppress |
| `rsi_below` | `rsi14(closes) ≤ level` | Any of last 7 daily RSI14 values ≤ level → suppress |
| `volume_spike` | `volume[-1] ≥ multiple × adv60` | Any of last 7 volumes ≥ multiple × adv60 → suppress |
| `news_match` | always `not_fired` (v1 stub) | n/a |

```ts
function evaluateRule(rule: InvalidationRule, candles: Candle[]) {
  const tail = candles.slice(-1);
  const last = tail[0];
  const fired = evaluateFireCondition(rule, last, candles);
  const window = candles.slice(-8, -1); // 7 sessions BEFORE today
  const wasFiredInWindow = window.some(c => evaluateFireCondition(rule, c, candles));
  return { fired, suppressed: fired && wasFiredInWindow };
}
```

**Benefit:** survives deploys, no GitHub Action, no Vercel KV, no committed state file. The "fire history" is implicit in market data.

**Cost:** if a rule fires on day N, the user un-fires it manually (no UI for this — they edit the YAML to acknowledge or rewrite), and the price holds above the level — fires every day for 7 days then auto-clears. Acceptable: it's a daily DM, not a per-tick alert, and a real invalidation usually means the user changes the YAML anyway.

---

## 7. Slack delivery — Block Kit payload

```ts
// lib/thesis/slack.ts
export async function sendSlackDigest(fires: FireRecord[]) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔥 ${fires.length} invalidation${fires.length > 1 ? "s" : ""} fired` },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `<!date^${Math.floor(Date.now()/1000)}^{date_pretty} · {time}|now>` }] },
    { type: "divider" },
    ...fires.flatMap(f => [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*<${process.env.NEXT_PUBLIC_APP_URL}/symbol/${f.ticker}|${f.ticker}>*` +
            `\n${f.rule.description ?? f.rule.id}` +
            `\nObserved: \`${f.evaluation.observed}\` · Threshold: \`${f.evaluation.threshold}\``,
        },
      },
    ]),
  ];

  const res = await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) console.error("[slack] webhook failed", res.status, await res.text());
}
```

One POST per cron run (C.2.2). No retries on failure (C.2.5).

---

## 8. UI integration

### 8.1 `/watchlist` — server component

```tsx
// app/watchlist/page.tsx
export default async function WatchlistPage() {
  const { watchlist, errors } = await loadWatchlist();
  const provider = getProvider();
  const enriched = await Promise.all(
    watchlist.tickers.map(async (entry) => {
      const symbol = await provider.getSymbol(entry.ticker);
      const fires = entry.invalidation_rules
        .map(r => ({ rule: r, ev: symbol ? evaluateRule(r, symbol.candles) : null }))
        .filter(x => x.ev?.fired);
      const horizon = entry.thesis ? horizonState(entry.thesis.time_horizon) : null;
      const progress = entry.thesis && symbol
        ? priceProgress(entry.thesis, symbol.quote.last) : null;
      return { entry, symbol, fires, horizon, progress };
    })
  );
  return <WatchlistView data={enriched} errors={errors} riskPct={watchlist.risk_pct} />;
}
```

### 8.2 Card layout deltas (mobile + table both)

| Element | Where it goes |
|---|---|
| 🔥 INVALIDATED banner (red) | Top of card if `fires.length > 0`, lists each fired rule |
| Thesis summary chip | Below ticker line |
| Progress bar `entry → exit` | If thesis present and price within band |
| `Horizon: 2026-08-31 (12d)` chip | With "approaching"/"expired" tones |
| Setup-tag-mismatch warning | If `thesis.setup_tag` ≠ engine-detected setup |
| Suggested shares hint | Symbol page only, not watchlist row |

Existing card components from P3 stay — we add a "Thesis" section between the metrics grid and the gate-mini-badges.

### 8.3 `/symbol/[ticker]` deltas

Below the existing "Trade plan" card, add:

```
┌──────────────────────────────────────┐
│ Thesis                                │
│ ─────────────────────────────────────│
│ Summary: …                            │
│ Setup tag: pullback   (engine: squeeze ⚠ mismatch) │
│ Confidence: ●●●○○ (3/5)               │
│ Entry: $2.67 → Exit: $5.00            │
│ Stop: $2.45  (engine, risk)           │
│ Invalidation: $2.30 (you, thesis death) │
│ Suggested shares: 67  (0.5% risk)     │
│ Horizon: 2026-08-31 (12 days)         │
│ Catalysts: Q2 earnings, summer slate  │
└──────────────────────────────────────┘
```

The mismatch warning chip is inline next to the setup tag; everything else is regular rows.

---

## 9. Migration from localStorage

Per A.4: one-time banner. Implementation:

```tsx
// In watchlist-client.tsx (still a client component for the banner)
useEffect(() => {
  const raw = localStorage.getItem("swing.watchlist.v1");
  if (!raw) return;
  setMigrationData(raw);
}, []);

function dismissMigration() {
  localStorage.removeItem("swing.watchlist.v1");
  setMigrationData(null);
}
```

Banner shows a copyable YAML snippet:

```yaml
# Paste under `tickers:` in data/watchlist.yaml
- ticker: ANGX
  status: active
# … one stub per legacy ticker
```

User pastes once, dismisses, never sees it again.

---

## 10. Library choices (locked)

| Concern | Choice | Reason |
|---|---|---|
| YAML parsing | `js-yaml` | Standard, zero-dep, sync API |
| Schema validation | `zod` | TS-native, discriminated unions, error reporting |
| Date math | None new (`Date` API) | Sufficient for ISO + days-between |
| Slack | Hand-rolled `fetch` + `Block Kit` JSON | No package needed |
| Email | None | Dropped |
| Cron persistence | None (stateless dedup) | §6 |
| State management | None new | Server components + URL state |

`package.json` adds: `js-yaml`, `@types/js-yaml`, `zod`. Three new deps total.

---

## 11. Env vars

```
WATCHLIST_PATH         (optional, default: ./data/watchlist.yaml)
SLACK_WEBHOOK_URL      (required for Feature C — without it, /api/check-invalidations skips slack POST)
CRON_SECRET            (required — verifies Vercel Cron calls)
ACCOUNT_EQUITY_USD     (optional, default: 33000 — drives suggested-shares hint)
NEXT_PUBLIC_APP_URL    (required — used in Slack message links to /symbol/[ticker])
GEMINI_API_KEY         (pre-existing, unchanged)
GEMINI_MODEL           (pre-existing, unchanged)
```

Add to `.env.example`; the user populates `.env.local` (dev) and Vercel project settings (prod).

---

## 12. Testing approach

Lightweight — single-user tool, no test framework required for v1, but the rule evaluator deserves coverage because bugs are silent (a missed fire is invisible).

- `lib/thesis/evaluate-rules.ts` — keep functions pure (candles → fire result) so they can be tested with hand-crafted candle arrays. Defer test infra; consider adding `vitest` only if a real bug surfaces.
- `lib/thesis/schema.ts` — zod's `safeParse` is the test. Manually craft 3-4 YAML examples (valid, type-mismatch, missing-required, malformed) and confirm validator behavior during the implementation phase.

---

## 13. Open implementation questions for tasks.md

1. **Setup-tag detection from the engine — where?** The engine's `evaluateSymbol()` already emits `gateSummary.setup`. The watchlist page calls `getSymbol()` not `evaluateSymbol()`. Decision: in the watchlist page's enrichment loop, also call `evaluateSymbol()` (or just `deriveMetrics + detectSetup`) so we have engine-detected setup to compare against user's `setup_tag`. ~15 LOC.
2. **What does the migration banner do if YAML can't be written from the browser?** It can't. The banner produces a clipboard-copy snippet only. User must paste manually. Acceptable.
3. **Should the watchlist page show entries with `status != active` at all?** Yes — collapsed by default, expandable. Dropped/shelved tickers are useful as personal memory ("why did I drop OWLT? oh right, tariffs"). Out of MVP scope to design; ship with all statuses visible in a tabbed UI.
4. **Daylight savings ambiguity in cron** — accepted as v1 imprecision. Re-evaluate post-Aug 17.

---

## 14. Tasks.md preview

The implementation will split into ~7 atomic commits, each independently shippable. Sketch:

1. **Schema + loader** — `lib/thesis/{schema,load}.ts`, `data/watchlist.yaml` with one real entry (ANGX), zero UI impact
2. **Rule evaluator + dedup** — `lib/thesis/evaluate-rules.ts`, pure functions, manually verified
3. **Watchlist page rewrite** — server component, drops localStorage, renders thesis + fires
4. **Symbol page thesis panel** — sizing hint, stop-vs-invalidation rows, setup-tag-mismatch chip
5. **Cron endpoint** — `app/api/check-invalidations/route.ts` returns JSON (no Slack yet)
6. **Slack delivery** — `lib/thesis/slack.ts` + env wiring; manual trigger test
7. **Vercel Cron config + production deploy** — `vercel.json`, env vars in Vercel UI, first scheduled run

Each commit type-checks and runs `npm run dev` without errors. Tasks.md will expand each into acceptance criteria + estimated effort.

---

## End of design
