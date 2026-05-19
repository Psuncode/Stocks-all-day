import { loadWatchlist, type LoadError } from "@/lib/thesis/load";
import { evaluateRule } from "@/lib/thesis/evaluate-rules";
import { getProvider } from "@/lib/data/provider";
import { sendSlackDigest, type FireRecord } from "@/lib/thesis/slack";
import { buildDigest, type DigestPick } from "@/lib/digest/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Full-universe digest scan exceeds the 10s hobby default. 60s is the hobby cap.
export const maxDuration = 60;

type DigestSummary = {
  ticker: string;
  decision: string;
  setup: string;
  rr: number | null;
};

type CheckResponse = {
  checked: number;
  skipped: number;
  fires: FireRecord[];
  digest: DigestSummary[];
  schema_errors: LoadError[];
  timestamp: string;
};

/**
 * Cron entrypoint — design.md §5.1.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. In dev when
 * CRON_SECRET is unset we allow the request so local curl tests work; in prod
 * Vercel will set the env var and unsigned calls will 401.
 *
 * Sequential candle fetch: provider has a 5-min cache and the watchlist is
 * small (<50 active tickers expected). Sequential avoids burst rate-limits.
 *
 * No Slack delivery here — that arrives in T6.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  if (secret && secret.length > 0) {
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  } else if (isProd) {
    // GSD review C2: missing CRON_SECRET in production must NOT silently
    // open the endpoint to anonymous callers. Fail closed.
    console.error(
      "[check-invalidations] CRON_SECRET unset in production — refusing request",
    );
    return new Response("Misconfigured: CRON_SECRET unset", { status: 500 });
  } else {
    console.warn(
      "[check-invalidations] CRON_SECRET unset — allowing request (dev only).",
    );
  }

  const { watchlist, errors } = await loadWatchlist();
  const active = watchlist.tickers.filter((t) => t.status === "active");

  const provider = getProvider();
  const fires: FireRecord[] = [];
  let skipped = 0;

  for (const entry of active) {
    let symbol;
    try {
      symbol = await provider.getSymbol(entry.ticker);
    } catch (e) {
      console.warn(
        `[check-invalidations] evaluation_skipped ${entry.ticker}: fetch error ${(e as Error).message}`,
      );
      skipped += 1;
      continue;
    }
    if (!symbol) {
      console.log(
        `[check-invalidations] evaluation_skipped ${entry.ticker}: no symbol data`,
      );
      skipped += 1;
      continue;
    }

    for (const rule of entry.invalidation_rules) {
      const evaluation = evaluateRule(rule, symbol.candles);
      if (evaluation.fired && !evaluation.suppressed) {
        const fire: FireRecord = {
          ticker: entry.ticker,
          rule_id: rule.id,
          rule_signal: rule.signal,
          observed: evaluation.observed,
          threshold: evaluation.threshold,
        };
        if (rule.description) fire.description = rule.description;
        fires.push(fire);
      }
    }
  }

  // Feature D — build the daily top-5 digest in parallel with no extra Yahoo
  // round-trips beyond the standard scan path. Failures here must NOT block
  // invalidation alerts (requirements.md §D.6).
  let picks: DigestPick[] = [];
  try {
    picks = await buildDigest();
  } catch (e) {
    console.error(
      `[check-invalidations] digest build failed: ${(e as Error).message}`,
    );
  }

  // Single combined POST: fires (if any) + digest (if any). Skipped when both
  // are empty or when SLACK_WEBHOOK_URL is unset. Errors swallowed inside.
  await sendSlackDigest(fires, picks);

  const body: CheckResponse = {
    checked: active.length,
    skipped,
    fires,
    digest: picks.map((p) => ({
      ticker: p.result.ticker,
      decision: p.result.decision,
      setup: p.result.gateSummary.setup,
      rr: p.result.plan?.rr ?? null,
    })),
    schema_errors: errors,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[check-invalidations] checked=${body.checked} skipped=${body.skipped} fires=${body.fires.length} digest=${body.digest.length} schema_errors=${body.schema_errors.length}`,
  );

  return Response.json(body);
}
