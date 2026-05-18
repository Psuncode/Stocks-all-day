"use client";

import { useMemo, useState } from "react";
import type { DecisionResult } from "@/lib/types";

type GeminiResponse = {
  text: string;
  model: string;
};

function buildContext(r: DecisionResult) {
  const failed = r.gates.flatMap((g) =>
    g.checks
      .filter((c) => !c.passed)
      .map((c) => ({ gate: g.gateId, check: c.id, label: c.label, message: c.message })),
  );

  return {
    ticker: r.ticker,
    sector: r.sector,
    decision: r.decision,
    reason: r.reason,
    gateSummary: r.gateSummary,
    metrics: r.metrics,
    plan: r.plan ?? null,
    failedChecks: failed,
  };
}

export function GeminiExplain({ result }: { result: DecisionResult }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  const context = useMemo(() => buildContext(result), [result]);

  async function run() {
    setLoading(true);
    setError(null);
    setText(null);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt:
            "Explain the trade decision in plain English. Be concise and practical. " +
            "Structure: (1) 1-sentence verdict (PASS/WATCH/TRADE), (2) top 3 drivers, " +
            "(3) what would need to change to upgrade/downgrade, (4) risk notes. " +
            "Do not make price predictions. Mention this is rule-based gating, not investment advice.",
          context,
          temperature: 0.3,
          maxOutputTokens: 500,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.message || e?.error || `Gemini error (${res.status})`);
      }
      const json = (await res.json()) as GeminiResponse;
      setText(json.text);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Gemini explanation</div>
          <div className="mt-2 text-xs text-zinc-500">
            Optional. Uses your server-side <span className="font-mono">GEMINI_API_KEY</span>.
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-full bg-emerald-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-200/50 transition-colors hover:bg-emerald-800 disabled:opacity-50"
        >
          {loading ? "Asking…" : "Explain"}
        </button>
      </div>

      {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
      {text && (
        <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-white/70 bg-white/90 p-4 text-sm text-zinc-800">
          {text}
        </div>
      )}
      {!error && !text && (
        <div className="mt-4 text-sm text-zinc-600">
          Click <span className="font-medium">Explain</span> to get a quick summary of the gate
          results.
        </div>
      )}
    </div>
  );
}
