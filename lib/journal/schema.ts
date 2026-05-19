/**
 * Trade journal schema (v4.0 T1).
 *
 * One record per trade. Long-only in the v4 UI; the schema supports
 * `side: "short"` for forward compatibility but no UI surfaces it yet.
 *
 * R-multiple sourcing order:
 *   1) explicit `stop_price` on the record
 *   2) `watchlist_thesis_ticker` → resolved at read-time to the YAML
 *      thesis's `invalidation_price`
 *   3) neither → R is null and that trade is excluded from avgR / expectancy
 */

import { z } from "zod";

const SetupTagSchema = z.enum([
  "PULLBACK",
  "BASE_BREAKOUT",
  "SQUEEZE",
  "OVERSOLD_BOUNCE",
  "NONE",
]);

export const TradeSide = z.enum(["long", "short"]);
export type TradeSide = z.infer<typeof TradeSide>;

export const TradeStatus = z.enum(["open", "closed"]);
export type TradeStatus = z.infer<typeof TradeStatus>;

// ISO YYYY-MM-DD only — strict format keeps later date math deterministic.
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

// Shared base shape — kept as a raw object so we can derive input variants
// without using zod's superRefine-incompatible .innerType().
const TradeBaseShape = {
  ticker: z
    .string()
    .regex(/^[A-Z0-9.\-]+$/, "uppercase ticker only (A-Z, 0-9, ., -)"),
  side: TradeSide.default("long"),
  status: TradeStatus,
  entry_date: IsoDate,
  entry_price: z.number().positive(),
  shares: z.number().positive(),
  setup_at_entry: SetupTagSchema.optional(),
  stop_price: z.number().positive().optional(),
  watchlist_thesis_ticker: z.string().optional(),
  exit_date: IsoDate.optional(),
  exit_price: z.number().positive().optional(),
  notes: z.string().optional(),
} as const;

const TradeBaseObject = z.object(TradeBaseShape);

function enforceClosedInvariants<T extends z.infer<typeof TradeBaseObject>>(
  r: T,
  ctx: z.RefinementCtx,
) {
  if (r.status === "closed") {
    if (!r.exit_date) {
      ctx.addIssue({
        code: "custom",
        message: "closed trades require exit_date",
        path: ["exit_date"],
      });
    }
    if (r.exit_price == null) {
      ctx.addIssue({
        code: "custom",
        message: "closed trades require exit_price",
        path: ["exit_price"],
      });
    }
  }
}

export const TradeRecord = z
  .object({
    id: z.string().min(1),
    ...TradeBaseShape,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .superRefine(enforceClosedInvariants);

export type TradeRecord = z.infer<typeof TradeRecord>;

/**
 * Shape for creating a new trade. The archive layer fills in
 * `id`, `created_at`, `updated_at`.
 */
export const NewTradeInput = TradeBaseObject.superRefine(
  enforceClosedInvariants,
);
export type NewTradeInput = z.infer<typeof NewTradeInput>;

/**
 * Shape for updates — every base field optional (server enforces the
 * closed-trade invariants on the merged result inside updateTrade()).
 */
export const UpdateTradeInput = TradeBaseObject.partial();
export type UpdateTradeInput = z.infer<typeof UpdateTradeInput>;

/**
 * Per-setup breakdown stats (read-time derived).
 */
export type SetupStats = {
  n: number;
  winRate: number; // closed trades with R available; 0 when n=0
  avgR: number; // 0 when no closed trades with risk
};

/**
 * Derived stats for the /journal stats strip + Friday Slack section.
 * Computed at read time; never stored.
 */
export type DerivedStats = {
  n: number;
  openN: number;
  closedN: number;
  /** Closed trades with a non-null R-multiple. */
  closedWithRn: number;
  winRate: number; // among closedWithRn
  avgR: number; // among closedWithRn
  /** $ P&L summed across all closed trades. */
  totalPnL: number;
  /** Sum of all winning $ P&L minus sum of all losing $ P&L. */
  expectancy: number;
  /** Per-setup breakdown — only setups with at least one closed trade. */
  bySetup: Record<string, SetupStats>;
};
