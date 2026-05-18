import type { Candle } from "@/lib/types";

export function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i]!;
  return sum / period;
}

export function trueRange(prevClose: number, high: number, low: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    ranges.push(trueRange(prev.c, cur.h, cur.l));
  }
  if (ranges.length === 0) return 0;
  // Simple moving average ATR for demo (good enough).
  if (ranges.length < period) return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  let sum = 0;
  for (let i = ranges.length - period; i < ranges.length; i++) sum += ranges[i]!;
  return sum / period;
}

export function pct(n: number, denom: number) {
  if (!Number.isFinite(n) || !Number.isFinite(denom) || denom === 0) return 0;
  return (n / denom) * 100;
}

export function slope(values: number[]) {
  // Simple slope proxy: (last - first) / N
  if (values.length < 2) return 0;
  return (values[values.length - 1]! - values[0]!) / (values.length - 1);
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

