import clsx from "clsx";
import type { GateResult } from "@/lib/types";
import { Badge } from "@/components/Badge";

function CheckIcon() {
  return (
    <svg className="inline h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="inline h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function statusTone(status: GateResult["status"]) {
  if (status === "PASS") return "ok" as const;
  if (status === "WATCH") return "watch" as const;
  return "block" as const;
}

function headerBorder(status: GateResult["status"]) {
  if (status === "PASS") return "border-green-100";
  if (status === "WATCH") return "border-amber-100";
  return "border-zinc-200";
}

export function GateBreakdown({ gates }: { gates: GateResult[] }) {
  return (
    <div className="space-y-3">
      {gates.map((g) => (
        <div key={g.gateId} className="rounded-xl border bg-white shadow-sm">
          <div className={clsx("flex items-start justify-between gap-3 border-b px-4 py-3", headerBorder(g.status))}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900">{g.title}</div>
              <div className="mt-0.5 text-xs text-zinc-600">{g.summary}</div>
            </div>
            <Badge tone={statusTone(g.status)}>{g.status}</Badge>
          </div>
          <div className="px-4 py-3">
            <div className="space-y-2">
              {g.checks.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-900">{c.label}</div>
                    <div className="text-xs text-zinc-600">{c.message}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-semibold text-zinc-900">
                      {String(c.observed)}
                    </div>
                    {c.threshold != null && (
                      <div className="text-[11px] text-zinc-500">thr: {String(c.threshold)}</div>
                    )}
                    <div className="mt-1 flex items-center justify-end gap-1.5">
                      {c.passed ? <CheckIcon /> : <XIcon />}
                      <Badge tone={c.passed ? "ok" : "block"}>
                        {c.passed ? "OK" : "FAIL"}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {g.whatToChange && g.whatToChange.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                <div className="text-xs font-semibold text-zinc-900">What would need to change</div>
                <ul className="mt-1 list-disc pl-5 text-xs text-zinc-700">
                  {g.whatToChange.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
