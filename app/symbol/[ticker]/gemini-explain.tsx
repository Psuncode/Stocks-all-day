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

export function GeminiExplain({
  result,
  enabled = true,
}: {
  result: DecisionResult;
  // v2.1 T4: server passes `false` when GEMINI_API_KEY is unset so the
  // button can be disabled with an explanatory tooltip instead of letting
  // the click silently fail at the API.
  enabled?: boolean;
}) {
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

  const buttonDisabled = loading || !enabled;
  const tooltip = !enabled ? "Enable Gemini in Settings" : undefined;

  return (
    <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Gemini explanation</div>
          <div className="mt-2 text-xs text-zinc-500">
            Optional. Uses your server-side <span className="font-mono">GEMINI_API_KEY</span>.
            {!enabled ? (
              <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                disabled
              </span>
            ) : null}
          </div>
        </div>
        <button
          onClick={run}
          disabled={buttonDisabled}
          title={tooltip}
          aria-disabled={buttonDisabled}
          className="rounded-full bg-emerald-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-200/50 transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none"
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
          {enabled ? (
            <>
              Click <span className="font-medium">Explain</span> to get a quick summary of the gate
              results.
            </>
          ) : (
            <>
              Add <span className="font-mono">GEMINI_API_KEY</span> to your environment to enable
              plain-English summaries.{" "}
              <a className="text-emerald-800 underline" href="/settings">
                Settings →
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
