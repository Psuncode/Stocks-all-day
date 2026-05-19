import type { Candle } from "@/lib/types";
import { rsi } from "@/lib/engine/indicators";
import type { InvalidationRule } from "@/lib/thesis/schema";

export type RuleEvaluation = {
  fired: boolean;
  suppressed: boolean;
  observed: number | string;
  threshold: number | string;
  status?: "pending_news_source" | "evaluation_skipped";
};

// Number of trading sessions back to inspect for stateless dedup (design.md §6).
const DEDUP_WINDOW = 7;

/**
 * Pure evaluator for a single invalidation rule against a candle series.
 *
 * Suppression is stateless: we look at the 7 daily sessions BEFORE the most
 * recent candle (candles[-8..-1]). If the same fire condition would have
 * tripped on any of those sessions, the current fire is suppressed.
 *
 * The `news_match` signal performs case-insensitive substring matching
 * against `newsHeadlines` when provided; when omitted, it reports
 * `pending_news_source` per requirements.md §B.2.6.
 */
export function evaluateRule(
  rule: InvalidationRule,
  candles: Candle[],
  newsHeadlines?: string[],
): RuleEvaluation {
  // No candles → cannot evaluate.
  if (candles.length === 0) {
    return {
      fired: false,
      suppressed: false,
      observed: "n/a",
      threshold: ruleThreshold(rule),
      status: "evaluation_skipped",
    };
  }

  switch (rule.signal) {
    case "price_below": {
      const last = candles[candles.length - 1]!;
      const fired = last.c <= rule.level;
      const suppressed =
        fired && priorWindow(candles).some((c) => c.c <= rule.level);
      return {
        fired,
        suppressed,
        observed: last.c,
        threshold: rule.level,
      };
    }
    case "price_above": {
      const last = candles[candles.length - 1]!;
      const fired = last.c >= rule.level;
      const suppressed =
        fired && priorWindow(candles).some((c) => c.c >= rule.level);
      return {
        fired,
        suppressed,
        observed: last.c,
        threshold: rule.level,
      };
    }
    case "rsi_above": {
      const period = rule.period;
      const closes = candles.map((c) => c.c);
      // Need at least `period + 1` closes to compute RSI per indicators.ts.
      if (closes.length < period + 1) {
        return {
          fired: false,
          suppressed: false,
          observed: "n/a",
          threshold: rule.level,
          status: "evaluation_skipped",
        };
      }
      const todayRsi = rsi(closes, period);
      const fired = todayRsi >= rule.level;
      const suppressed =
        fired &&
        priorRsiWindow(closes, period).some((r) => r >= rule.level);
      return {
        fired,
        suppressed,
        observed: round2(todayRsi),
        threshold: rule.level,
      };
    }
    case "rsi_below": {
      const period = rule.period;
      const closes = candles.map((c) => c.c);
      if (closes.length < period + 1) {
        return {
          fired: false,
          suppressed: false,
          observed: "n/a",
          threshold: rule.level,
          status: "evaluation_skipped",
        };
      }
      const todayRsi = rsi(closes, period);
      const fired = todayRsi <= rule.level;
      const suppressed =
        fired &&
        priorRsiWindow(closes, period).some((r) => r <= rule.level);
      return {
        fired,
        suppressed,
        observed: round2(todayRsi),
        threshold: rule.level,
      };
    }
    case "volume_spike": {
      const last = candles[candles.length - 1]!;
      // 60-day ADV computed from the 60 sessions BEFORE today.
      const advToday = adv(candles, candles.length - 1, 60);
      if (advToday === null) {
        return {
          fired: false,
          suppressed: false,
          observed: "n/a",
          threshold: rule.multiple,
          status: "evaluation_skipped",
        };
      }
      const fired = last.v >= rule.multiple * advToday;
      // Suppression: any of the prior 7 sessions also met the spike condition,
      // each evaluated against its own trailing 60-day ADV.
      let suppressed = false;
      if (fired) {
        const start = Math.max(0, candles.length - 1 - DEDUP_WINDOW);
        for (let i = start; i < candles.length - 1; i++) {
          const advPrior = adv(candles, i, 60);
          if (advPrior === null) continue;
          if (candles[i]!.v >= rule.multiple * advPrior) {
            suppressed = true;
            break;
          }
        }
      }
      return {
        fired,
        suppressed,
        observed: last.v,
        threshold: round2(rule.multiple * advToday),
      };
    }
    case "news_match": {
      if (newsHeadlines === undefined) {
        return {
          fired: false,
          suppressed: false,
          observed: "n/a",
          threshold: rule.pattern,
          status: "pending_news_source",
        };
      }
      const needle = rule.pattern.toLowerCase();
      const fired = newsHeadlines.some((h) =>
        h.toLowerCase().includes(needle),
      );
      return {
        fired,
        suppressed: false,
        observed: newsHeadlines.length,
        threshold: rule.pattern,
      };
    }
  }
}

function ruleThreshold(rule: InvalidationRule): number | string {
  switch (rule.signal) {
    case "price_below":
    case "price_above":
      return rule.level;
    case "rsi_above":
    case "rsi_below":
      return rule.level;
    case "volume_spike":
      return rule.multiple;
    case "news_match":
      return rule.pattern;
  }
}

function priorWindow(candles: Candle[]): Candle[] {
  // The 7 trading sessions BEFORE the most recent candle (design.md §6).
  // Equivalent to candles.slice(-8, -1) when there are ≥ 8 candles.
  const end = candles.length - 1;
  const start = Math.max(0, end - DEDUP_WINDOW);
  return candles.slice(start, end);
}

function priorRsiWindow(closes: number[], period: number): number[] {
  // RSI value at session i is computed using closes[..i] (inclusive).
  // Build the prior-N RSI values (capped at DEDUP_WINDOW), one per session,
  // ending at the second-to-last close.
  //
  // GSD review H4: previous code could produce >DEDUP_WINDOW values on
  // short series (lastIdx - DEDUP_WINDOW < period). Clamp the count.
  const out: number[] = [];
  const lastIdx = closes.length - 1;
  const start = Math.max(period, lastIdx - DEDUP_WINDOW);
  for (let i = start; i < lastIdx; i++) {
    const sliceCloses = closes.slice(0, i + 1);
    out.push(rsi(sliceCloses, period));
  }
  return out.slice(-DEDUP_WINDOW);
}

/**
 * Average daily volume over the `period` sessions BEFORE index `i` (exclusive of i).
 * Returns null if fewer than `period` prior sessions exist.
 */
function adv(candles: Candle[], i: number, period: number): number | null {
  const start = i - period;
  if (start < 0) return null;
  let sum = 0;
  for (let k = start; k < i; k++) sum += candles[k]!.v;
  return sum / period;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
