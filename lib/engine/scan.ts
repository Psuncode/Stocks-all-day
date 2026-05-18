import type { Candle, Decision, DecisionResult, ScanConfig, UniverseSymbol } from "@/lib/types";
import { evaluateSymbol, todayYmd } from "@/lib/engine/evaluate";

export function runScan(universe: UniverseSymbol[], cfg: ScanConfig, spy: Candle[]): DecisionResult[] {
  const asOf = todayYmd();
  const allowEarningsTrades = cfg.allowEarningsTrades;

  const evaluated = universe.map((s) => evaluateSymbol(s, universe, { allowEarningsTrades }, asOf, spy));

  const loaded = cfg.includeBlocked
    ? evaluated
    : evaluated.filter((r) => {
        const universeGate = r.gates.find((g) => g.gateId === "UNIVERSE");
        return universeGate?.status !== "BLOCK";
      });

  const decisionFiltered =
    cfg.decisionFilter === "ALL" ? loaded : loaded.filter((r) => r.decision === cfg.decisionFilter);

  const whyBlocked = cfg.whyBlockedOnly
    ? decisionFiltered.filter((r) => r.decision === "PASS")
    : decisionFiltered;

  const sorted = whyBlocked.sort((a, b) => {
    const prio = (d: Decision) => (d === "TRADE" ? 0 : d === "WATCH" ? 1 : 2);
    const p = prio(a.decision) - prio(b.decision);
    if (p !== 0) return p;
    // Prefer tighter spread and higher ADV for similar decisions.
    const s = a.metrics.spreadPct - b.metrics.spreadPct;
    if (Math.abs(s) > 1e-6) return s;
    return b.metrics.advUsd - a.metrics.advUsd;
  });

  return cfg.maxRows <= 0 ? sorted : sorted.slice(0, cfg.maxRows);
}

