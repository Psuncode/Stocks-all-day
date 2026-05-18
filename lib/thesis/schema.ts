import { z } from "zod";

export const SetupTag = z.enum([
  "pullback",
  "base_breakout",
  "squeeze",
  "oversold_bounce",
  "none",
]);
export type SetupTag = z.infer<typeof SetupTag>;

export const ThesisType = z.enum(["technical", "catalyst", "mixed"]);
export type ThesisType = z.infer<typeof ThesisType>;

export const TickerStatus = z.enum([
  "active",
  "research_pending",
  "shelved",
  "dropped",
  "exited",
]);
export type TickerStatus = z.infer<typeof TickerStatus>;

const ruleBase = {
  id: z.string().min(1),
  description: z.string().optional(),
};

const PriceBelow = z.object({
  ...ruleBase,
  signal: z.literal("price_below"),
  level: z.number().positive(),
});

const PriceAbove = z.object({
  ...ruleBase,
  signal: z.literal("price_above"),
  level: z.number().positive(),
});

const RsiAbove = z.object({
  ...ruleBase,
  signal: z.literal("rsi_above"),
  period: z.number().int().positive().default(14),
  level: z.number().min(0).max(100),
});

const RsiBelow = z.object({
  ...ruleBase,
  signal: z.literal("rsi_below"),
  period: z.number().int().positive().default(14),
  level: z.number().min(0).max(100),
});

const VolumeSpike = z.object({
  ...ruleBase,
  signal: z.literal("volume_spike"),
  multiple: z.number().positive().default(3),
});

const NewsMatch = z.object({
  ...ruleBase,
  signal: z.literal("news_match"),
  pattern: z.string().min(1),
});

export const InvalidationRule = z.discriminatedUnion("signal", [
  PriceBelow,
  PriceAbove,
  RsiAbove,
  RsiBelow,
  VolumeSpike,
  NewsMatch,
]);
export type InvalidationRule = z.infer<typeof InvalidationRule>;
export type RuleSignal = InvalidationRule["signal"];

export const ALLOWED_SIGNALS_BY_TYPE: Record<ThesisType, ReadonlySet<RuleSignal>> = {
  technical: new Set<RuleSignal>([
    "price_below",
    "price_above",
    "rsi_above",
    "rsi_below",
    "volume_spike",
  ]),
  catalyst: new Set<RuleSignal>(["news_match"]),
  mixed: new Set<RuleSignal>([
    "price_below",
    "price_above",
    "rsi_above",
    "rsi_below",
    "volume_spike",
    "news_match",
  ]),
};

export const Thesis = z.object({
  summary: z.string().min(1),
  thesis_type: ThesisType,
  setup_tag: SetupTag.optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  entry_target: z.number().positive(),
  exit_target: z.number().positive(),
  invalidation_price: z.number().positive(),
  time_horizon: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date"),
  catalysts: z.array(z.string()).default([]),
});
export type Thesis = z.infer<typeof Thesis>;

export const HistoryEntry = z.object({
  date: z.string(),
  result: z.string(),
  setup_tag: SetupTag.optional(),
  spy_trend_on_exit: z.enum(["up", "down", "chop"]).optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const TickerEntry = z
  .object({
    ticker: z
      .string()
      .regex(/^[A-Z0-9.\-]+$/, "uppercase ticker only (A-Z, 0-9, ., -)"),
    name: z.string().optional(),
    status: TickerStatus,
    sector_tag: z.string().optional(),
    thesis: Thesis.optional(),
    invalidation_rules: z.array(InvalidationRule).default([]),
    sizing: z
      .object({
        position_pct: z.number().min(0).max(100).optional(),
        notes: z.string().optional(),
      })
      .optional(),
    history: z.array(HistoryEntry).default([]),
    obsidian_link: z.string().optional(),
    notes: z.string().optional(),
    dropped_at: z.string().optional(),
    dropped_reason: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    // A.2.2 — thesis-type / invalidation-type matching
    if (entry.thesis) {
      const allowed = ALLOWED_SIGNALS_BY_TYPE[entry.thesis.thesis_type];
      entry.invalidation_rules.forEach((rule, i) => {
        if (!allowed.has(rule.signal)) {
          ctx.addIssue({
            code: "custom",
            path: ["invalidation_rules", i, "signal"],
            message: `Signal "${rule.signal}" not allowed for thesis_type "${entry.thesis!.thesis_type}". See requirements.md §B.5.`,
          });
        }
      });
    }

    // Required-iff: dropped/exited need dropped_at + dropped_reason
    if (entry.status === "dropped" || entry.status === "exited") {
      if (!entry.dropped_at) {
        ctx.addIssue({
          code: "custom",
          path: ["dropped_at"],
          message: `${entry.status} status requires dropped_at`,
        });
      }
      if (!entry.dropped_reason) {
        ctx.addIssue({
          code: "custom",
          path: ["dropped_reason"],
          message: `${entry.status} status requires dropped_reason`,
        });
      }
    }
  });
export type TickerEntry = z.infer<typeof TickerEntry>;

export const Watchlist = z.object({
  version: z.literal(1),
  risk_pct: z.number().min(0).max(100).default(0.5),
  tickers: z.array(TickerEntry).default([]),
});
export type Watchlist = z.infer<typeof Watchlist>;
