import { loadWatchlist, type LoadError } from "@/lib/thesis/load";
import { evaluateRule } from "@/lib/thesis/evaluate-rules";
import { getProvider } from "@/lib/data/provider";
import { fetchCompanyNews } from "@/lib/data/finnhub";
import {
  sendSlackDigest,
  type FireRecord,
  type JournalDigest,
} from "@/lib/thesis/slack";
import { buildDigest, type DigestPick } from "@/lib/digest/build";

import { persistDigest } from "@/lib/digest/archive";
import { todayYmd } from "@/lib/engine/evaluate";
import { loadWeeklyStats } from "@/lib/journal/archive";

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
  const newsSinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

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

    const needsNews = entry.invalidation_rules.some(
      (r) => r.signal === "news_match",
    );
    const newsHeadlines: string[] | undefined = needsNews
      ? (await fetchCompanyNews(entry.ticker, newsSinceDate)).map(
          (n) => n.headline,
        )
      : undefined;

    for (const rule of entry.invalidation_rules) {
      const evaluation = evaluateRule(rule, symbol.candles, newsHeadlines);
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

  // Feature D — build the daily digest. Web archive uses `picks` (top 5 of
  // TRADE+WATCH); Slack uses `topPick` (single best pick across all tiers,
  // including PASS as final fallback). Failures here must NOT block
  // invalidation alerts (requirements.md §D.6).
  let picks: DigestPick[] = [];
  let topPick: DigestPick | null = null;
  try {
    const built = await buildDigest();
    picks = built.picks;
    topPick = built.topPick;
  } catch (e) {
    console.error(
      `[check-invalidations] digest build failed: ${(e as Error).message}`,
    );
  }

  // Feature E — persist the digest snapshot for the /digest archive. Must
  // not block the Slack delivery if KV is unavailable (E.5).
  if (picks.length > 0) {
    try {
      const archiveResult = await persistDigest(todayYmd(), picks);
      if (!archiveResult.ok) {
        console.warn(
          `[check-invalidations] digest archive skipped: ${archiveResult.reason}`,
        );
      }
    } catch (e) {
      console.error(
        `[check-invalidations] digest archive threw: ${(e as Error).message}`,
      );
    }
  }

  // v4.0 T4: on Fridays, also include a journal "Week in trades" section.
  // Cron fires at 21:05 UTC, which is mid-evening Friday in ET — UTC day 5.
  // Failure-soft: any stats error is logged and skipped; the digest still ships.
  let journal: JournalDigest | undefined;
  const isFriday = new Date().getUTCDay() === 5;
  if (isFriday) {
    try {
      const weeklyStats = await loadWeeklyStats(7);
      journal = { date: todayYmd(), weeklyStats };
    } catch (e) {
      console.error(
        `[check-invalidations] journal stats failed: ${(e as Error).message}`,
      );
      // Don't block delivery.
    }
  }

  // Single combined POST: fires (if any) + digest (if any) + journal (Fri only).
  // Skipped when all are empty or when SLACK_WEBHOOK_URL is unset. Errors
  // swallowed inside.
  await sendSlackDigest(fires, topPick, journal);

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
