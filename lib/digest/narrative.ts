/**
 * Per-pick narrative builder for the Slack digest (Feature D, v1.2.2).
 *
 * The engine's bare `reason` field ("Meets constraints; requires monitoring.")
 * is accurate but unhelpful in a Slack message you scan in 5 seconds. This
 * builder generates a short multi-line description that says (a) what the
 * setup looks like in plain language, (b) what happened today, (c) what's
 * blocking action (for WATCH). Pure function — no API calls, no LLM.
 */

import type { Candle, DecisionResult } from "@/lib/types";

const SETUP_HEADLINE: Record<string, { trade: string; watch: string }> = {
  BASE_BREAKOUT: {
    trade: "Coiled at 60-day highs, breakout triggered — needs volume confirmation.",
    watch: "Coiling at 60-day highs; base looks ready but trigger not hit yet.",
  },
  PULLBACK: {
    trade: "Healthy pullback to SMA20 within an uptrend — entry near support.",
    watch: "Pulling back inside an uptrend; waiting for the bounce off SMA20.",
  },
  SQUEEZE: {
    trade: "Volatility compressed below historical norm — range expansion firing.",
    watch: "Tightly coiled, ATR depressed; expansion likely but direction unclear.",
  },
  OVERSOLD_BOUNCE: {
    trade: "Within 6% of 60-day low, RSI oversold, green reversal bar — bounce live.",
    watch: "Approaching 60-day low and oversold by RSI; watch for reversal candle.",
  },
};

function todayMoveBlurb(candles: Candle[]): string | null {
  if (candles.length < 31) return null;
  const last = candles[candles.length - 1]!;
  const prior = candles[candles.length - 2]!;
  const pctMove = ((last.c - prior.c) / prior.c) * 100;
  const trailing30 = candles.slice(-31, -1);
  const avgVol =
    trailing30.reduce((sum, c) => sum + c.v, 0) / Math.max(1, trailing30.length);
  const volMult = avgVol > 0 ? last.v / avgVol : 1;

  const significant = Math.abs(pctMove) >= 1.2 || volMult >= 1.4;
  if (!significant) return null;

  const dir = pctMove >= 0 ? "↑" : "↓";
  const moveStr = `${dir}${Math.abs(pctMove).toFixed(1)}%`;
  const volStr = volMult >= 1.3 ? ` on ${volMult.toFixed(1)}× volume` : "";
  return `Today ${moveStr}${volStr}.`;
}

function whatsBlocking(r: DecisionResult): string | null {
  if (r.decision !== "WATCH") return null;
  const summary = r.gateSummary;

  // Setup gate is what gates TRADE most often. If setup is NONE, that's the gap.
  if (summary.setup === "NONE") {
    return "Gates clear but no actionable setup yet — watching for compression or pullback.";
  }
  if (summary.trend === "MIXED") {
    return "Trend mixed — needs SMA50 reclaim or RS to flip positive.";
  }
  if (summary.vol === "HIGH") {
    return "High vol — size down or wait for ATR to contract.";
  }
  if (summary.liquidity === "CARE") {
    return "Thin tape — use limits, expect slippage.";
  }
  if (summary.event === "RISK") {
    return "Earnings inside ±10 days — flat by default unless opted in.";
  }
  // Setup is present but TRADE didn't fire — usually trigger or R:R.
  if (r.plan && r.plan.rr < 2) {
    return `R:R is ${r.plan.rr}x — wait for better entry or tighter stop.`;
  }
  return "Setup forming; trigger not hit. Stay ready.";
}

export function buildNarrative(
  result: DecisionResult,
  candles: Candle[],
): string {
  const lines: string[] = [];

  const setup = result.gateSummary.setup;
  const setupKey = SETUP_HEADLINE[setup];
  if (setupKey) {
    lines.push(result.decision === "TRADE" ? setupKey.trade : setupKey.watch);
  } else if (result.decision === "WATCH") {
    lines.push(
      "Gates aligned but no clean setup yet — keeping it on the bench.",
    );
  } else {
    // Fall back to the engine's reason if we have nothing better.
    lines.push(result.reason);
  }

  const today = todayMoveBlurb(candles);
  if (today) lines.push(today);

  const blocking = whatsBlocking(result);
  if (blocking) lines.push(blocking);

  return lines.join(" ");
}
