import Link from "next/link";
import clsx from "clsx";
import { Badge } from "@/components/Badge";
import type { TickerEntry } from "@/lib/thesis/schema";
import type { RuleEvaluation } from "@/lib/thesis/evaluate-rules";
import type { HorizonState } from "@/lib/thesis/horizon";

export type FireRecord = {
  ruleId: string;
  description: string;
  observed: number | string;
  threshold: number | string;
};

export type EnrichedEntry = {
  entry: TickerEntry;
  available: boolean; // false if provider.getSymbol returned null
  lastPrice: number | null;
  horizon: { date: string; state: HorizonState; daysFromNow: number } | null;
  priceProgressPct: number | null; // 0..100 or null
  fires: FireRecord[];
  ruleEvaluations: {
    ruleId: string;
    description: string;
    ev: RuleEvaluation | null;
  }[];
  // T5 — Earnings calendar overlay. ISO YYYY-MM-DD when known, null otherwise.
  earningsDate?: string | null;
  // Calendar days from today; negative when in the past. Optional so cards
  // without earnings data simply omit the chip.
  daysToEarnings?: number | null;
};

// T5 — format an ISO date as e.g. "Aug 31". Falls back to the raw slice if
// the date is unparseable.
function formatEarningsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// T6 — 90-day default thesis window. YAML entries don't carry a created_at,
// so we assume each thesis spans the quarter ending at time_horizon.
const THESIS_WINDOW_DAYS = 90;

function progressBarColor(pctElapsed: number): string {
  if (pctElapsed >= 100) return "bg-red-500";
  if (pctElapsed >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

function horizonTone(state: HorizonState): "neutral" | "watch" | "block" {
  if (state === "future") return "neutral";
  if (state === "approaching") return "watch";
  return "block";
}

function horizonLabel(
  state: HorizonState,
  date: string,
  days: number,
): string {
  if (state === "expired") return `Horizon expired (${date}, ${-days}d ago)`;
  if (state === "approaching") return `Horizon ${date} (${days}d)`;
  return `Horizon ${date} (${days}d)`;
}

function ConfidenceDots({ value }: { value: number }) {
  const dots: string[] = [];
  for (let i = 1; i <= 5; i++) dots.push(i <= value ? "●" : "○");
  return (
    <span
      className="tabular-nums text-zinc-700"
      aria-label={`Confidence ${value} of 5`}
      title={`Confidence ${value}/5`}
    >
      {dots.join("")}
    </span>
  );
}

export function ThesisCard({
  data,
  variant = "card",
}: {
  data: EnrichedEntry;
  variant?: "card" | "row";
}) {
  const { entry, available, lastPrice, horizon, priceProgressPct, fires } =
    data;
  const t = entry.ticker;
  const thesis = entry.thesis;

  // T5 — earnings chip visibility: only when known AND within the next 30 days
  // (inclusive of today, exclusive of past). Engine already advances past
  // events so we treat negative deltas as "not interesting" and hide.
  const earningsDate = data.earningsDate ?? null;
  const daysToEarnings = data.daysToEarnings ?? null;
  const showEarningsChip =
    !!earningsDate &&
    daysToEarnings !== null &&
    daysToEarnings >= 0 &&
    daysToEarnings <= 30;
  const earningsInEventWindow =
    daysToEarnings !== null && daysToEarnings >= 0 && daysToEarnings <= 10;

  // T6 — days-left progress bar. Assume a 90-day window ending at
  // time_horizon. elapsedDays = window - daysFromHorizon, clamped to
  // [0, window]. If today is past the horizon, bar fills past 100%.
  let pctElapsed: number | null = null;
  if (horizon) {
    const daysFromHorizon = horizon.daysFromNow; // positive = future, negative = past
    const rawElapsed = THESIS_WINDOW_DAYS - daysFromHorizon;
    const clampedElapsed = Math.max(
      0,
      Math.min(THESIS_WINDOW_DAYS, rawElapsed),
    );
    // Allow >100% so the bar can render fully red when past horizon.
    pctElapsed =
      daysFromHorizon < 0
        ? Math.min(150, (rawElapsed / THESIS_WINDOW_DAYS) * 100)
        : (clampedElapsed / THESIS_WINDOW_DAYS) * 100;
  }

  return (
    <div
      className={clsx(
        "rounded-2xl border p-4 transition-colors",
        fires.length > 0
          ? "border-red-200 bg-red-50/40"
          : variant === "card"
            ? "border-zinc-100 bg-white"
            : "border-zinc-100 bg-white",
      )}
    >
      {/* Fire banner */}
      {fires.length > 0 && (
        <div className="-mx-4 -mt-4 mb-3 rounded-t-2xl border-b border-red-200 bg-red-100/80 px-4 py-2 text-sm">
          <div className="font-semibold text-red-900">
            {"🔥 INVALIDATED"} ({fires.length} fired)
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-red-900">
            {fires.map((f) => (
              <li key={f.ruleId} className="tabular-nums">
                <span className="font-medium">{f.description}</span>{" "}
                <span className="text-red-700">
                  · observed {String(f.observed)} vs threshold{" "}
                  {String(f.threshold)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-base font-bold text-zinc-900">{t}</span>
          {entry.name && (
            <span className="text-xs text-zinc-500">{entry.name}</span>
          )}
          {!available && <Badge tone="neutral">no data</Badge>}
          {entry.sector_tag && (
            <Badge tone="soft">{entry.sector_tag}</Badge>
          )}
        </div>
        <Link
          href={`/symbol/${encodeURIComponent(t)}`}
          className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
        >
          Details
        </Link>
      </div>

      {/* Thesis block */}
      {thesis ? (
        <div className="mt-3 space-y-2">
          <div className="text-sm text-zinc-700">{thesis.summary}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {thesis.setup_tag && thesis.setup_tag !== "none" && (
              <Badge tone="info">setup: {thesis.setup_tag}</Badge>
            )}
            <Badge tone="soft">type: {thesis.thesis_type}</Badge>
            {typeof thesis.confidence === "number" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-inset ring-zinc-200">
                <ConfidenceDots value={thesis.confidence} />
              </span>
            )}
            {horizon && (
              <Badge tone={horizonTone(horizon.state)}>
                {horizonLabel(horizon.state, horizon.date, horizon.daysFromNow)}
              </Badge>
            )}
            {showEarningsChip && earningsDate && daysToEarnings !== null && (
              <Badge tone={earningsInEventWindow ? "watch" : "info"}>
                📅 Earnings {formatEarningsDate(earningsDate)} · in{" "}
                {daysToEarnings}d
              </Badge>
            )}
          </div>

          {/* T6 — days-left progress bar: how much of a 90-day thesis window
              has elapsed up to time_horizon. Supplementary to the horizon
              badge above, not a replacement. */}
          {pctElapsed !== null && (
            <div
              className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-100"
              role="progressbar"
              aria-label="Thesis horizon elapsed"
              aria-valuenow={Math.round(Math.min(100, pctElapsed))}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={clsx("h-full", progressBarColor(pctElapsed))}
                style={{ width: `${Math.min(100, pctElapsed)}%` }}
              />
            </div>
          )}

          {/* Entry → exit + progress bar */}
          <div className="mt-1">
            <div className="flex items-center justify-between text-xs tabular-nums text-zinc-600">
              <span>Entry ${thesis.entry_target.toFixed(2)}</span>
              <span>
                {lastPrice !== null ? (
                  <>now ${lastPrice.toFixed(2)}</>
                ) : (
                  <>—</>
                )}
              </span>
              <span>Exit ${thesis.exit_target.toFixed(2)}</span>
            </div>
            {priceProgressPct !== null && (
              <div
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-valuenow={Math.round(priceProgressPct)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-emerald-600"
                  style={{ width: `${priceProgressPct}%` }}
                />
              </div>
            )}
          </div>

          <div className="text-xs tabular-nums text-zinc-500">
            Invalidation ${thesis.invalidation_price.toFixed(2)}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-zinc-500">
          {/* v2.1 T5: for shelved/dropped/exited entries without a thesis,
              show the drop reason inline instead of the bare "No thesis
              yet" placeholder. Drop info card below adds structure. */}
          {entry.dropped_reason ??
            entry.notes ??
            (entry.status === "shelved" ||
            entry.status === "dropped" ||
            entry.status === "exited"
              ? `${entry.status} without a reason captured.`
              : "No thesis yet.")}
        </div>
      )}

      {/* Drop info (now also covers shelved per v2.1 T5) */}
      {(entry.status === "dropped" ||
        entry.status === "exited" ||
        entry.status === "shelved") && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <div className="font-semibold text-zinc-700">
            {entry.status} {entry.dropped_at ? `· ${entry.dropped_at}` : null}
          </div>
          {entry.dropped_reason && (
            <div className="mt-1">{entry.dropped_reason}</div>
          )}
        </div>
      )}

      {/* Watching N rules (collapsed) */}
      {entry.invalidation_rules.length > 0 && fires.length === 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">
            Watching {entry.invalidation_rules.length} rule
            {entry.invalidation_rules.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-zinc-600">
            {data.ruleEvaluations.map((re) => (
              <li key={re.ruleId} className="tabular-nums">
                <span className="font-mono text-[10px] text-zinc-400">
                  {re.ruleId}
                </span>{" "}
                {re.description}
                {re.ev?.status === "pending_news_source" && (
                  <span className="ml-1 text-zinc-400">
                    (pending news source)
                  </span>
                )}
                {re.ev?.status === "evaluation_skipped" && (
                  <span className="ml-1 text-zinc-400">
                    (no data — skipped)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
