import { loadWatchlist, type LoadError } from "@/lib/thesis/load";
import { evaluateRule } from "@/lib/thesis/evaluate-rules";
import { getProvider } from "@/lib/data/provider";
import { sendSlackDigest, type FireRecord } from "@/lib/thesis/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResponse = {
  checked: number;
  skipped: number;
  fires: FireRecord[];
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

  if (secret && secret.length > 0) {
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  } else {
    console.warn(
      "[check-invalidations] CRON_SECRET unset — allowing request (dev mode only). Set CRON_SECRET in production.",
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

  // Deliver Slack digest (T6) — single POST with all fires. No-op when fires
  // is empty (alert-only mode) or when SLACK_WEBHOOK_URL is unset. Errors are
  // swallowed inside sendSlackDigest so a Slack outage does not fail the cron.
  await sendSlackDigest(fires);

  const body: CheckResponse = {
    checked: active.length,
    skipped,
    fires,
    schema_errors: errors,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[check-invalidations] checked=${body.checked} skipped=${body.skipped} fires=${body.fires.length} schema_errors=${body.schema_errors.length}`,
  );

  return Response.json(body);
}
