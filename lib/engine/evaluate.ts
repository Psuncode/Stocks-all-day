import type {
  Candle,
  Decision,
  DecisionResult,
  DerivedMetrics,
  GateResult,
  GateStatus,
  ScanConfig,
  SetupTag,
  UniverseSymbol,
} from "@/lib/types";
import { atr, pct, rsi, sma, slope } from "@/lib/engine/indicators";

function round(n: number, d = 2) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

// GSD review M3: single source of truth for the LOW/MED/HIGH banding.
type VolBand = "LOW" | "MED" | "HIGH";
function volBandFor(atrPct: number): VolBand {
  if (atrPct > 4) return "HIGH";
  if (atrPct > 2) return "MED";
  return "LOW";
}

function daysBetween(aYmd: string, bYmd: string) {
  const a = new Date(`${aYmd}T00:00:00Z`).getTime();
  const b = new Date(`${bYmd}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function gate(
  gateId: GateResult["gateId"],
  title: string,
  status: GateStatus,
  summary: string,
  checks: GateResult["checks"],
  whatToChange?: string[],
): GateResult {
  return { gateId, title, status, summary, checks, whatToChange };
}

function last<T>(arr: T[]) {
  return arr[arr.length - 1];
}

function highest(candles: Candle[], n: number) {
  const slice = candles.slice(Math.max(0, candles.length - n));
  return Math.max(...slice.map((c) => c.h));
}

function lowest(candles: Candle[], n: number) {
  const slice = candles.slice(Math.max(0, candles.length - n));
  return Math.min(...slice.map((c) => c.l));
}

function rangePct(candles: Candle[], n: number) {
  const hi = highest(candles, n);
  const lo = lowest(candles, n);
  const mid = (hi + lo) / 2;
  return pct(hi - lo, mid);
}

export function deriveMetrics(symbol: UniverseSymbol, spy: Candle[]): DerivedMetrics {
  const candles = symbol.candles;
  const closes = candles.map((c) => c.c);
  const price = symbol.quote.last;
  const mid = (symbol.quote.ask + symbol.quote.bid) / 2;
  const spreadPct = pct(symbol.quote.ask - symbol.quote.bid, mid);
  const atr14 = atr(candles, 14);
  const atrPct = pct(atr14, price);

  const advWindow = candles.slice(Math.max(0, candles.length - 30));
  const advUsd =
    advWindow.reduce((sum, c) => sum + c.c * c.v, 0) / Math.max(1, advWindow.length);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma15 = sma(closes, 15);

  // 3W (15-session) momentum metrics — see "sustainedHighVol" below.
  const atr15 = atr(candles, 15);
  const atr15Pct = pct(atr15, price);
  const closes15 = closes.slice(-15);
  const slope15Raw = slope(closes15); // raw price change per day
  const slope15PctPerDay = sma15 > 0 ? (slope15Raw / sma15) * 100 : 0;
  const priceToSma15Pct = pct(price - sma15, sma15);
  const prevClose = closes[closes.length - 2] ?? price;
  const todayMoveAtrMult = atr14 > 0 ? Math.abs(price - prevClose) / atr14 : 0;

  const spyCloses = spy.map((c) => c.c);
  const spySma20 = sma(spyCloses, 20);
  const spySma50 = sma(spyCloses, 50);
  const spyTrendUp = last(spyCloses) > spySma50 && spySma20 >= spySma50;

  // Chop proxy: little trend, but meaningful realized vol.
  const spyAtrPct = pct(atr(spy, 14), last(spyCloses));
  const spySlope20 = slope(spyCloses.slice(-20));
  const spyChop = Math.abs(spySlope20) < 0.15 && spyAtrPct > 0.9;

  // GSD review H1: rs60 must align symbol tail to the SAME trailing
  // window of SPY. Newly-listed names have fewer than 60 candles; the
  // previous code paired their day-0 close with SPY 60 days ago, which
  // produced junk RS values. Align by tail length instead.
  const symCloses = closes.slice(-60);
  const spyTail = spyCloses.slice(-symCloses.length);
  const denomFallback = spyTail[spyTail.length - 1] ?? 1;
  const ratios = symCloses.map(
    (c, i) => c / (spyTail[i] || denomFallback),
  );
  const rs60 = ratios.length >= 2 ? slope(ratios) * 10_000 : 0;

  // v1.4 / v1.8 — "3W momentum": HIGH VOLUME + high volatility + tracking
  // the 15-day average + meaningful direction. Surfaces names you can
  // actually fill orders on, that have been consistently moving for ~3
  // weeks, without one-day spike chasing.
  const recent5Vols = candles.slice(-5).map((c) => c.v);
  const prior25Vols = candles
    .slice(Math.max(0, candles.length - 30), candles.length - 5)
    .map((c) => c.v);
  const avgVol5 =
    recent5Vols.reduce((s, v) => s + v, 0) / Math.max(1, recent5Vols.length);
  const avgVol25 =
    prior25Vols.reduce((s, v) => s + v, 0) / Math.max(1, prior25Vols.length);
  const volumeSustained = avgVol25 > 0 ? avgVol5 / avgVol25 >= 0.7 : true;

  const sustainedHighVol =
    advUsd >= 25_000_000 &&             // high dollar volume (v1.8)
    volumeSustained &&                  // volume isn't collapsing (v1.8)
    atr15Pct >= 3 &&                    // high volatility (15-session ATR)
    Math.abs(priceToSma15Pct) <= 3 &&   // hugging the 3-week average
    Math.abs(slope15PctPerDay) >= 0.3 &&// real trend, not chop
    todayMoveAtrMult <= 1.5;            // not a freak spike

  return {
    price,
    spreadPct,
    advUsd,
    sma20,
    sma50,
    sma200,
    sma15,
    atr14,
    atrPct,
    atr15Pct,
    slope15PctPerDay,
    priceToSma15Pct,
    todayMoveAtrMult,
    rs60,
    spyTrendUp,
    spyChop,
    sustainedHighVol,
  };
}

/**
 * GSD review C1: precompute average rs60 per sector once per scan.
 * The old code re-ran deriveMetrics for every same-sector peer inside the
 * per-symbol EVENT gate, producing O(N × avg_sector_size) deriveMetrics
 * calls per scan. With 600 names × ~60 peers per sector that was ~36,000
 * redundant evaluations and the dominant reason the cron flirted with the
 * 60s function-duration cap.
 */
export function buildSectorRsMap(
  universe: UniverseSymbol[],
  spy: Candle[],
): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const u of universe) {
    // GSD review H5: skip names with too little history or bad data so
    // sector RS isn't polluted by fallback / IPO-recent entries with
    // junk rs60. This is independent of the scanner's includeBlocked
    // flag — sector momentum is a market-wide signal, not a per-row UI
    // choice.
    if (u.candles.length < 60 || u.quote.last <= 0) continue;
    const sector = u.meta.sector;
    const m = deriveMetrics(u, spy);
    const cur = totals.get(sector);
    if (cur) {
      cur.sum += m.rs60;
      cur.count += 1;
    } else {
      totals.set(sector, { sum: m.rs60, count: 1 });
    }
  }
  const out = new Map<string, number>();
  for (const [sector, { sum, count }] of totals) {
    out.set(sector, sum / Math.max(1, count));
  }
  return out;
}

export function evaluateSymbol(
  symbol: UniverseSymbol,
  universe: UniverseSymbol[],
  cfg: Pick<ScanConfig, "allowEarningsTrades">,
  asOf: string,
  spy: Candle[],
  sectorRsByName?: Map<string, number>,
): DecisionResult {
  const m = deriveMetrics(symbol, spy);

  const gates: GateResult[] = [];

  // Gate UNIVERSE (hard)
  const universeChecks: GateResult["checks"] = [];
  const priceOk = m.price >= 5 && m.price <= 100;
  universeChecks.push({
    id: "price_range",
    label: "Price between $5 and $100",
    passed: priceOk,
    observed: round(m.price, 2),
    threshold: "$5–$100",
    message: priceOk ? "Within universe." : "Outside the $5–$100 universe.",
  });
  const advOk = m.advUsd >= 10_000_000;
  universeChecks.push({
    id: "adv_usd",
    label: "Avg daily $ volume ≥ $10M",
    passed: advOk,
    observed: Math.round(m.advUsd),
    threshold: 10_000_000,
    message: advOk ? "Meets liquidity floor." : "Fails liquidity floor.",
  });
  const spreadOk = m.spreadPct <= 0.25;
  universeChecks.push({
    id: "spread_pct",
    label: "Spread ≤ 0.25%",
    passed: spreadOk,
    observed: round(m.spreadPct, 3),
    threshold: 0.25,
    message: spreadOk ? "Execution friction acceptable." : "Spread too wide for clean execution.",
  });

  const universePass = priceOk && advOk && spreadOk;
  gates.push(
    gate(
      "UNIVERSE",
      "Universe (Hard Constraints)",
      universePass ? "PASS" : "BLOCK",
      universePass ? "Loaded." : "Blocked: fails universe constraints.",
      universeChecks,
      universePass
        ? undefined
        : universeChecks.filter((c) => !c.passed).map((c) => c.message),
    ),
  );

  if (!universePass) {
    return {
      ticker: symbol.meta.ticker,
      name: symbol.meta.name,
      sector: symbol.meta.sector,
      decision: "PASS",
      reason: "Blocked by hard universe constraints.",
      gateSummary: {
        trend: "MIXED",
        vol: m.atrPct > 4 ? "HIGH" : m.atrPct > 2 ? "MED" : "LOW",
        liquidity: "AVOID",
        event: symbol.earningsDate ? "RISK" : "NONE",
        setup: "NONE",
      },
      metrics: {
        price: m.price,
        spreadPct: m.spreadPct,
        advUsd: m.advUsd,
        atrPct: m.atrPct,
        rs60: m.rs60,
        atr15Pct: m.atr15Pct,
        slope15PctPerDay: m.slope15PctPerDay,
        priceToSma15Pct: m.priceToSma15Pct,
        sustainedHighVol: m.sustainedHighVol,
      },
      gates,
      updatedAt: new Date().toISOString(),
    };
  }

  // Oversold-bounce candidate: lets counter-trend names survive the TREND gate.
  const candles = symbol.candles;
  const closes = candles.map((c) => c.c);
  const low60ForBounce = lowest(candles, 60);
  const nearLow60Pct = pct(m.price - low60ForBounce, low60ForBounce);
  const rsi14 = rsi(closes, 14);
  const prevClose = closes[closes.length - 2] ?? m.price;
  const reversalBar = m.price > prevClose;
  const bounceCandidate = nearLow60Pct <= 6 && rsi14 <= 32 && reversalBar;

  // Gate TREND
  const trendChecks: GateResult["checks"] = [];
  const upMa = m.sma20 >= m.sma50 && m.sma50 >= m.sma200;
  const above50 = m.price >= m.sma50;
  const rsOk = m.rs60 >= -0.5;
  trendChecks.push({
    id: "ma_stack",
    label: "20 ≥ 50 ≥ 200",
    passed: upMa,
    observed: `${round(m.sma20)} / ${round(m.sma50)} / ${round(m.sma200)}`,
    threshold: "20≥50≥200",
    message: upMa ? "Trend stacked." : "Trend not stacked.",
  });
  trendChecks.push({
    id: "above_50",
    label: "Price ≥ 50-day",
    passed: above50,
    observed: round(m.price),
    threshold: round(m.sma50),
    message: above50 ? "Trading above 50-day." : "Below 50-day; trend risk.",
  });
  trendChecks.push({
    id: "rs_vs_spy",
    label: "Relative strength vs SPY (60d)",
    passed: rsOk,
    observed: round(m.rs60, 2),
    threshold: -0.5,
    message: rsOk ? "Not lagging materially." : "Lagging SPY.",
  });

  const trendAligned = upMa && above50 && rsOk;
  const trendMixed = universePass && (above50 || rsOk);
  const counterTrend = !trendAligned && !trendMixed;
  // Bounce candidates ride past the counter-trend BLOCK as WATCH.
  const trendStatus: GateStatus = trendAligned
    ? "PASS"
    : trendMixed || (counterTrend && bounceCandidate)
      ? "WATCH"
      : "BLOCK";
  gates.push(
    gate(
      "TREND",
      "Market & Trend Alignment",
      trendStatus,
      trendAligned
        ? "Trend aligned (long bias)."
        : trendStatus === "WATCH"
          ? counterTrend && bounceCandidate
            ? "Counter-trend, but oversold-bounce candidate."
            : "Mixed: requires caution."
          : "Counter-trend: blocked.",
      trendChecks,
      trendStatus === "BLOCK" ? ["Wait for trend alignment (price above 50-day and MA stack)."] : undefined,
    ),
  );

  if (trendStatus === "BLOCK") {
    return finalize(symbol, m, gates, "PASS", "Counter-trend context.", asOf, universe);
  }

  // Gate VOL
  const volChecks: GateResult["checks"] = [];
  const volBand = volBandFor(m.atrPct);
  volChecks.push({
    id: "atr_pct",
    label: "ATR% band",
    passed: volBand !== "HIGH",
    observed: round(m.atrPct, 2),
    threshold: "≤ 4% preferred",
    message:
      volBand === "LOW"
        ? "Low vol: normal sizing, patience."
        : volBand === "MED"
          ? "Medium vol: standard swing rules."
          : "High vol: size down or pass.",
  });
  const highVolNoCatalyst = volBand === "HIGH" && !symbol.hasCatalyst;
  volChecks.push({
    id: "high_vol_requires_catalyst",
    label: "High vol requires catalyst",
    passed: !highVolNoCatalyst,
    observed: symbol.hasCatalyst ? "has catalyst" : "no catalyst",
    threshold: "catalyst",
    message: highVolNoCatalyst ? "High vol + no catalyst = PASS." : "Vol context acceptable.",
  });
  const volStatus: GateStatus =
    highVolNoCatalyst ? "BLOCK" : volBand === "HIGH" ? "WATCH" : "PASS";
  gates.push(
    gate(
      "VOL",
      "Volatility Regime (Sizing Governor)",
      volStatus,
      volStatus === "BLOCK"
        ? "Blocked: high volatility without catalyst."
        : volStatus === "WATCH"
          ? "High volatility: reduce size and demand cleaner setup."
          : "Volatility acceptable.",
      volChecks,
      volStatus === "BLOCK" ? ["Wait for volatility to contract or a real catalyst."] : undefined,
    ),
  );

  if (volStatus === "BLOCK") {
    return finalize(symbol, m, gates, "PASS", "Risk is mechanically too high.", asOf, universe);
  }

  // Gate LIQUIDITY
  const liqChecks: GateResult["checks"] = [];
  const clean = m.advUsd >= 25_000_000 && m.spreadPct <= 0.15;
  const tradeable = m.advUsd >= 10_000_000 && m.spreadPct <= 0.30;
  liqChecks.push({
    id: "adv_quality",
    label: "ADV$ execution quality",
    passed: m.advUsd >= 20_000_000,
    observed: Math.round(m.advUsd),
    threshold: 20_000_000,
    message: m.advUsd >= 20_000_000 ? "Good depth." : "Thin tape: slippage risk.",
  });
  liqChecks.push({
    id: "spread_quality",
    label: "Spread quality",
    passed: m.spreadPct <= 0.18,
    observed: round(m.spreadPct, 3),
    threshold: 0.18,
    message: m.spreadPct <= 0.18 ? "Clean execution." : "Execution requires care.",
  });
  const liqStatus: GateStatus = clean ? "PASS" : tradeable ? "WATCH" : "BLOCK";
  gates.push(
    gate(
      "LIQUIDITY",
      "Liquidity & Execution Reality",
      liqStatus,
      liqStatus === "PASS"
        ? "Clean execution."
        : liqStatus === "WATCH"
          ? "Tradeable with care."
          : "Avoid: execution risk dominates.",
      liqChecks,
      liqStatus === "BLOCK" ? ["Require tighter spread and higher ADV$."] : undefined,
    ),
  );
  if (liqStatus === "BLOCK") {
    return finalize(symbol, m, gates, "PASS", "Execution risk > setup quality.", asOf, universe);
  }

  // Gate EVENT
  const eventChecks: GateResult["checks"] = [];
  let earningsRisk = false;
  let daysToEarnings: number | null = null;
  if (symbol.earningsDate) {
    daysToEarnings = daysBetween(asOf, symbol.earningsDate);
    earningsRisk = Math.abs(daysToEarnings) <= 10;
  }
  eventChecks.push({
    id: "earnings_window",
    label: "Earnings proximity (±10d)",
    passed: !earningsRisk,
    observed: symbol.earningsDate ? `${daysToEarnings} days` : "none",
    threshold: "outside ±10d",
    message: earningsRisk
      ? "Earnings window: default is PASS (no gambling)."
      : "No near-term earnings risk.",
  });

  // Sector momentum proxy: average RS of symbols in same sector.
  // Use the precomputed map when runScan provided one (fast path); otherwise
  // fall back to the live computation for one-off evaluateSymbol callers
  // (e.g. /api/symbol/[ticker] and /symbol/[ticker]/page.tsx).
  let sectorRs: number;
  if (sectorRsByName) {
    sectorRs = sectorRsByName.get(symbol.meta.sector) ?? 0;
  } else {
    const sectorSyms = universe.filter(
      (u) => u.meta.sector === symbol.meta.sector,
    );
    sectorRs =
      sectorSyms.reduce((sum, s) => sum + deriveMetrics(s, spy).rs60, 0) /
      Math.max(1, sectorSyms.length);
  }
  const sectorWeak = sectorRs < -0.75;
  eventChecks.push({
    id: "sector_momentum",
    label: "Sector momentum vs market",
    passed: !sectorWeak,
    observed: round(sectorRs, 2),
    threshold: -0.75,
    message: sectorWeak ? "Sector dragging; demand cleaner setup." : "Sector neutral/positive.",
  });

  const eventStatus: GateStatus =
    earningsRisk && !cfg.allowEarningsTrades ? "BLOCK" : earningsRisk || sectorWeak ? "WATCH" : "PASS";
  gates.push(
    gate(
      "EVENT",
      "Event & Catalyst Context",
      eventStatus,
      eventStatus === "BLOCK"
        ? "Blocked: earnings risk (opt-out)."
        : eventStatus === "WATCH"
          ? "Event/sector context requires caution."
          : "Context clean.",
      eventChecks,
      eventStatus === "BLOCK" ? ["Wait until earnings pass (or explicitly opt in)."] : undefined,
    ),
  );
  if (eventStatus === "BLOCK") {
    return finalize(symbol, m, gates, "PASS", "Event risk not allowed by default.", asOf, universe);
  }

  // Gate SETUP (decision compression)
  const setupChecks: GateResult["checks"] = [];
  const high60 = highest(candles, 60);
  const high10 = highest(candles, 10);
  const low10 = lowest(candles, 10);
  const distToHigh60Pct = pct(high60 - m.price, high60);
  const distToSma20Pct = pct(m.price - m.sma20, m.sma20);

  const pullbackZone = distToSma20Pct >= -1.5 && distToSma20Pct <= 2.0;
  const pullbackDepth = pct(high10 - m.price, high10);
  const pullbackOk = pullbackZone && pullbackDepth >= 1.5 && pullbackDepth <= 8;

  const baseRange = rangePct(candles, 15);
  const baseOk = baseRange <= 4.5 && distToHigh60Pct <= 1.2;

  const squeezeOk = m.atrPct <= 2.1 && rangePct(candles, 10) <= 2.8 && m.price >= m.sma20;

  setupChecks.push({
    id: "pullback",
    label: "Trend pullback",
    passed: pullbackOk,
    observed: `dist SMA20 ${round(distToSma20Pct, 2)}% / depth ${round(pullbackDepth, 2)}%`,
    threshold: "near SMA20 + 1.5–8% depth",
    message: pullbackOk ? "Pullback zone." : "Not a clean pullback zone.",
  });
  setupChecks.push({
    id: "base_breakout",
    label: "Base breakout",
    passed: baseOk,
    observed: `15d range ${round(baseRange, 2)}% / to 60d high ${round(distToHigh60Pct, 2)}%`,
    threshold: "tight base near highs",
    message: baseOk ? "Base near breakout level." : "No tight base near highs.",
  });
  setupChecks.push({
    id: "squeeze",
    label: "Failed breakdown / squeeze",
    passed: squeezeOk,
    observed: `ATR% ${round(m.atrPct, 2)} / 10d range ${round(rangePct(candles, 10), 2)}%`,
    threshold: "low ATR% + tight range",
    message: squeezeOk ? "Volatility compressed." : "No squeeze conditions.",
  });

  const bounceOk = bounceCandidate && counterTrend;
  setupChecks.push({
    id: "oversold_bounce",
    label: "Oversold mean-reversion bounce",
    passed: bounceOk,
    observed: `near 60d low ${round(nearLow60Pct, 2)}% / RSI14 ${round(rsi14, 1)}`,
    threshold: "≤6% from 60d low + RSI ≤32 + green reversal",
    message: bounceOk ? "Oversold bounce setup." : "No oversold-bounce conditions.",
  });

  let setup: SetupTag = "NONE";
  // Counter-trend bounce takes precedence in counter-trend regimes;
  // otherwise prefer the trend-following setups.
  if (bounceOk) setup = "OVERSOLD_BOUNCE";
  else if (pullbackOk) setup = "PULLBACK";
  else if (baseOk) setup = "BASE_BREAKOUT";
  else if (squeezeOk) setup = "SQUEEZE";

  // Trigger + risk plan
  const atr14 = m.atr14;
  const entry =
    setup === "PULLBACK"
      ? m.price + 0.1 * atr14
      : setup === "BASE_BREAKOUT"
        ? high60 + 0.05 * atr14
        : setup === "SQUEEZE"
          ? highest(candles, 5) + 0.05 * atr14
          : setup === "OVERSOLD_BOUNCE"
            ? m.price + 0.1 * atr14
            : m.price;
  const stop =
    setup === "PULLBACK"
      ? low10 - 0.2 * atr14
      : setup === "BASE_BREAKOUT"
        ? entry - 1.2 * atr14
        : setup === "SQUEEZE"
          ? entry - 1.0 * atr14
          : setup === "OVERSOLD_BOUNCE"
            ? low60ForBounce - 0.3 * atr14
            : m.price;
  const target =
    setup === "PULLBACK"
      ? high10
      : setup === "BASE_BREAKOUT"
        ? entry + 2.5 * atr14
        : setup === "SQUEEZE"
          ? entry + 2.0 * atr14
          : setup === "OVERSOLD_BOUNCE"
            ? m.sma20
            : m.price;

  const stopDistPct = pct(entry - stop, entry);
  // GSD review L7: if the engine produced a degenerate stop (entry <= stop),
  // the trade is uninvestable. Force rr to 0 so the SETUP gate fails the
  // rr >= 2 check rather than dividing by a 0.01 floor and reporting a
  // hugely-inflated R:R.
  const riskDist = entry - stop;
  const rr = riskDist > 0 ? (target - entry) / riskDist : 0;

  const triggerHit =
    setup === "PULLBACK"
      ? m.price >= m.sma20
      : setup === "BASE_BREAKOUT"
        ? m.price >= high60 * 0.995
        : setup === "SQUEEZE"
          ? m.price >= highest(candles, 5) * 0.995
          : setup === "OVERSOLD_BOUNCE"
            ? reversalBar
            : false;

  setupChecks.push({
    id: "risk_stop",
    label: "Stop distance ≤ 4%",
    passed: stopDistPct <= 4,
    observed: `${round(stopDistPct, 2)}%`,
    threshold: "≤ 4%",
    message: stopDistPct <= 4 ? "Stop is reasonable." : "Stop too wide for this universe.",
  });
  setupChecks.push({
    id: "rr",
    label: "Expected R:R ≥ 2.0",
    passed: rr >= 2,
    observed: round(rr, 2),
    threshold: 2.0,
    message: rr >= 2 ? "Meets minimum R:R." : "R:R not compelling.",
  });
  setupChecks.push({
    id: "trigger",
    label: "Trigger hit (actionable)",
    passed: triggerHit,
    observed: triggerHit ? "yes" : "no",
    threshold: "yes",
    message: triggerHit ? "Actionable now." : "Not triggered yet.",
  });

  let setupStatus: GateStatus = "BLOCK";
  if (setup === "NONE") setupStatus = "BLOCK";
  else if (rr < 1.6 || stopDistPct > 5) setupStatus = "BLOCK";
  else if (!triggerHit || rr < 2 || stopDistPct > 4 || trendStatus === "WATCH" || volStatus === "WATCH" || liqStatus === "WATCH" || eventStatus === "WATCH")
    setupStatus = "WATCH";
  else setupStatus = "PASS";

  gates.push(
    gate(
      "SETUP",
      "Setup Quality (Decision Compression)",
      setupStatus,
      setupStatus === "PASS"
        ? "TRADE: setup qualifies."
        : setupStatus === "WATCH"
          ? "WATCH: close, but not ready."
          : "PASS: no allowed setup (or risk fails).",
      setupChecks,
      setupStatus === "BLOCK"
        ? ["Require one allowed pattern + acceptable stop + R:R."]
        : setupStatus === "WATCH"
          ? ["Wait for trigger and/or improved risk/reward."]
          : undefined,
    ),
  );

  let decision: Decision = "WATCH";
  let reason = "Meets constraints; requires monitoring.";
  if (setupStatus === "PASS") {
    decision = "TRADE";
    reason = "All gates align and the setup is actionable.";
  } else if (setupStatus === "BLOCK") {
    decision = "PASS";
    reason = "Does not meet setup/risk requirements.";
  }

  // Market chop downgrade (thesis rule).
  if (m.spyChop) {
    if (decision === "TRADE") {
      decision = "WATCH";
      reason = "SPY chop regime: downgraded one level.";
    } else if (decision === "WATCH") {
      decision = "PASS";
      reason = "SPY chop regime: downgraded one level.";
    }
  }

  const gateSummary = {
    trend: trendAligned
      ? "ALIGNED"
      : counterTrend && bounceCandidate
        ? "COUNTER"
        : "MIXED",
    vol: volBand,
    liquidity: clean ? "CLEAN" : "CARE",
    event: earningsRisk ? "RISK" : symbol.hasCatalyst ? "OK" : "NONE",
    setup,
  } as const;

  const plan =
    decision === "TRADE"
      ? {
          entry: round(entry, 2),
          stop: round(stop, 2),
          target: round(target, 2),
          rr: round(rr, 2),
          estHold: (setup === "BASE_BREAKOUT" ? "1-3w" : "3-5d") as "1-3w" | "3-5d",
        }
      : undefined;

  return {
    ticker: symbol.meta.ticker,
    name: symbol.meta.name,
    sector: symbol.meta.sector,
    decision,
    reason,
    gateSummary,
    metrics: {
      price: m.price,
      spreadPct: m.spreadPct,
      advUsd: m.advUsd,
      atrPct: m.atrPct,
      rs60: m.rs60,
        atr15Pct: m.atr15Pct,
        slope15PctPerDay: m.slope15PctPerDay,
        priceToSma15Pct: m.priceToSma15Pct,
        sustainedHighVol: m.sustainedHighVol,
    },
    plan,
    gates,
    updatedAt: new Date().toISOString(),
  };
}

function finalize(
  symbol: UniverseSymbol,
  m: DerivedMetrics,
  gates: GateResult[],
  decision: Decision,
  reason: string,
  asOf: string,
  universe: UniverseSymbol[],
): DecisionResult {
  const volBand = volBandFor(m.atrPct);
  return {
    ticker: symbol.meta.ticker,
    name: symbol.meta.name,
    sector: symbol.meta.sector,
    decision,
    reason,
    gateSummary: {
      trend: "MIXED",
      vol: volBand,
      liquidity: "CARE",
      event: symbol.earningsDate ? "RISK" : "NONE",
      setup: "NONE",
    },
    metrics: {
      price: m.price,
      spreadPct: m.spreadPct,
      advUsd: m.advUsd,
      atrPct: m.atrPct,
      rs60: m.rs60,
        atr15Pct: m.atr15Pct,
        slope15PctPerDay: m.slope15PctPerDay,
        priceToSma15Pct: m.priceToSma15Pct,
        sustainedHighVol: m.sustainedHighVol,
    },
    gates,
    updatedAt: new Date().toISOString(),
  };
}

export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
