export type Decision = "PASS" | "WATCH" | "TRADE";

export type GateStatus = "PASS" | "WATCH" | "BLOCK";

export type RuleCheck = {
  id: string;
  label: string;
  passed: boolean;
  observed: number | string | null;
  threshold: number | string | null;
  message: string;
};

export type GateResult = {
  gateId: "UNIVERSE" | "TREND" | "VOL" | "LIQUIDITY" | "EVENT" | "SETUP";
  title: string;
  status: GateStatus;
  summary: string;
  checks: RuleCheck[];
  whatToChange?: string[];
};

export type Candle = {
  t: string; // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Quote = {
  last: number;
  bid: number;
  ask: number;
  updatedAt: string; // ISO
};

export type SymbolMeta = {
  ticker: string;
  name: string;
  sector: string;
};

export type UniverseSymbol = {
  meta: SymbolMeta;
  candles: Candle[]; // daily
  quote: Quote;
  earningsDate: string | null; // YYYY-MM-DD
  hasCatalyst: boolean;
};

export type DerivedMetrics = {
  price: number;
  spreadPct: number;
  advUsd: number;
  sma20: number;
  sma50: number;
  sma200: number;
  sma15: number;
  atr14: number;
  atrPct: number;
  atr15Pct: number;
  slope15PctPerDay: number;
  priceToSma15Pct: number;
  todayMoveAtrMult: number;
  rs60: number; // relative strength slope proxy
  spyTrendUp: boolean;
  spyChop: boolean;
  // 3W momentum (v1.4): high vol but tracking the 15-day average, not a
  // one-day spike. See lib/engine/evaluate.ts deriveMetrics for thresholds.
  sustainedHighVol: boolean;
};

export type SetupTag = "PULLBACK" | "BASE_BREAKOUT" | "SQUEEZE" | "OVERSOLD_BOUNCE" | "NONE";

export type DecisionResult = {
  ticker: string;
  name: string;
  sector: string;
  decision: Decision;
  reason: string;
  gateSummary: {
    trend: "ALIGNED" | "MIXED" | "COUNTER";
    vol: "LOW" | "MED" | "HIGH";
    liquidity: "CLEAN" | "CARE" | "AVOID";
    event: "OK" | "RISK" | "NONE";
    setup: SetupTag;
  };
  metrics: Pick<
    DerivedMetrics,
    | "price"
    | "spreadPct"
    | "advUsd"
    | "atrPct"
    | "rs60"
    | "atr15Pct"
    | "slope15PctPerDay"
    | "priceToSma15Pct"
    | "sustainedHighVol"
  >;
  plan?: {
    entry: number;
    stop: number;
    target: number;
    rr: number;
    estHold: "3-5d" | "1-3w";
  };
  gates: GateResult[];
  updatedAt: string;
};

export type ScanConfig = {
  includeBlocked: boolean;
  allowEarningsTrades: boolean;
  decisionFilter: Decision | "ALL";
  whyBlockedOnly: boolean;
  maxRows: number;
};

