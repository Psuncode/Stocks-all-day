/**
 * Slack delivery — invalidations (Feature C) + daily digest (Feature D).
 *
 * One webhook POST per cron run with fires (if any) and digest picks (if any).
 *
 * Charts: each pick gets a quickchart.io "shortlink" — we POST the chart config
 * to /chart/create and receive a short URL like https://quickchart.io/chart/render/sf-...
 * Inline-encoding 30 daily closes (CHART_POINTS) plus the SMA15 overlay still
 * pushed the image_url over Slack's ~3KB limit when annotations were enabled,
 * and the entire webhook payload was rejected silently. Shortlinks fix it.
 *
 * Failure modes:
 *  - SLACK_WEBHOOK_URL unset: log + skip (dev).
 *  - Chart shortlink POST fails: skip the image, keep the text section.
 *  - Webhook POST fails: log + swallow. No retries.
 */

import type { DigestPick } from "@/lib/digest/build";
import { isHealthcareSector, isUtahTicker } from "@/lib/preferences";

export type FireRecord = {
  ticker: string;
  rule_id: string;
  rule_signal: string;
  description?: string;
  observed: number | string;
  threshold: number | string;
};

type SlackBlock =
  | {
      type: "header";
      text: { type: "plain_text"; text: string; emoji?: boolean };
    }
  | {
      type: "context";
      elements: Array<{ type: "mrkdwn"; text: string }>;
    }
  | { type: "divider" }
  | {
      type: "section";
      text: { type: "mrkdwn"; text: string };
    }
  | {
      type: "image";
      image_url: string;
      alt_text: string;
    };

type SlackPayload = { blocks: SlackBlock[] };

const CHART_POINTS = 30;
const CHART_WIDTH = 600;
const CHART_HEIGHT = 220;

// ---------------------------------------------------------------------------
// Invalidation blocks (Feature C — visual hierarchy tightened)
// ---------------------------------------------------------------------------

function fireBlocks(fires: FireRecord[], appUrl: string): SlackBlock[] {
  if (fires.length === 0) return [];
  const plural = fires.length > 1 ? "s" : "";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🔥 ${fires.length} thesis invalidation${plural}`,
        emoji: true,
      },
    },
  ];

  for (const fire of fires) {
    const link = `*<${appUrl}/symbol/${fire.ticker}|${fire.ticker}>*`;
    const label = fire.description ?? fire.rule_id;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `${link}  ·  _${label}_\n` +
          `Observed \`${fire.observed}\` vs threshold \`${fire.threshold}\``,
      },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Digest blocks (Feature D — better visual hierarchy)
// ---------------------------------------------------------------------------

function setupLabel(setup: string): string {
  if (setup === "NONE") return "";
  return setup.toLowerCase().replace("_", " ");
}

function decisionTag(decision: string): string {
  if (decision === "TRADE") return "⭐ TRADE";
  if (decision === "WATCH") return "👀 WATCH";
  return decision;
}

async function pickBlocks(
  picks: DigestPick[],
  appUrl: string,
): Promise<SlackBlock[]> {
  if (picks.length === 0) return [];
  const nowEpoch = Math.floor(Date.now() / 1000);

  // GSD review H6: chart shortlink POSTs to quickchart.io run in parallel
  // instead of awaiting one at a time inside the block-build loop.
  // Saves ~2.5s on a 5-pick digest.
  const chartUrls = await Promise.all(
    picks.map((pick) =>
      chartShortUrl(pick.result.ticker, pick.candles, pick.result.plan),
    ),
  );

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📊 Today's ${picks.length}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<!date^${nowEpoch}^{date_pretty}|today> · engine-ranked candidates · not investment advice`,
        },
      ],
    },
  ];

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i]!;
    const r = pick.result;
    const tickerLink = `*<${appUrl}/symbol/${r.ticker}|${r.ticker}>*`;
    const price = `\`$${r.metrics.price.toFixed(2)}\``;
    const setup = setupLabel(r.gateSummary.setup);
    const setupTag = setup ? `  ·  *${setup}*` : "";
    const sector = r.sector ? `  ·  ${r.sector}` : "";

    const momentumTag = r.metrics.sustainedHighVol ? "  ·  🌀 3W momentum" : "";
    const prefTags: string[] = [];
    if (isUtahTicker(r.ticker)) prefTags.push("🏔️ Utah");
    if (isHealthcareSector(r.sector)) prefTags.push("❤️ Healthcare");
    const prefSuffix = prefTags.length ? "  ·  " + prefTags.join(" · ") : "";
    const headerLine = `${tickerLink}  ${price}  ·  ${decisionTag(r.decision)}${setupTag}${momentumTag}${sector}${prefSuffix}`;
    const narrative = `> ${pick.narrative}`;
    const planLine = r.plan
      ? `\nEntry \`$${r.plan.entry}\` → Stop \`$${r.plan.stop}\` → Target \`$${r.plan.target}\`  ·  *R:R ${r.plan.rr}x*  ·  est ${r.plan.estHold}`
      : "";

    const gates =
      `\n_Trend ${r.gateSummary.trend.toLowerCase()} · ` +
      `vol ${r.gateSummary.vol.toLowerCase()} (ATR ${r.metrics.atrPct.toFixed(1)}%) · ` +
      `liquidity ${r.gateSummary.liquidity.toLowerCase()} (ADV$ ${(r.metrics.advUsd / 1_000_000).toFixed(0)}M)_`;

    // Research links — one tap from Slack to Google Finance / Yahoo. Per
    // user workflow: digest = decide whether to research further; external
    // links = the deep-dive surface.
    const researchLine =
      `\n🔍 <https://www.google.com/finance/quote/${encodeURIComponent(r.ticker)}|Google Finance>` +
      ` · <https://finance.yahoo.com/quote/${encodeURIComponent(r.ticker)}|Yahoo>`;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: headerLine + "\n" + narrative + planLine + gates + researchLine,
      },
    });

    const chart = chartUrls[i];
    if (chart) {
      blocks.push({
        type: "image",
        image_url: chart,
        alt_text: `${r.ticker} ${CHART_POINTS}-session chart`,
      });
    }

    if (i < picks.length - 1) {
      blocks.push({ type: "divider" });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// quickchart.io shortlink builder (POST → small URL)
// ---------------------------------------------------------------------------

type PlanOverlay = { entry: number; stop: number; target: number };

function rollingSma(
  values: number[],
  period: number,
): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

async function chartShortUrl(
  ticker: string,
  candles: Array<{ t: string; c: number }>,
  plan?: PlanOverlay,
): Promise<string | null> {
  if (candles.length < 2) return null;

  // Use the full 90 closes to seed the SMA15 lookback, then slice to the
  // window we display so the SMA line has real values from session 1 of
  // the visible chart instead of nulls.
  const seedCount = Math.min(candles.length, CHART_POINTS + 14);
  const seeded = candles.slice(-seedCount);
  const seededCloses = seeded.map((c) => c.c);
  const sma15Full = rollingSma(seededCloses, 15);
  const visibleStart = Math.max(0, seeded.length - CHART_POINTS);
  const recent = seeded.slice(visibleStart);
  const labels = recent.map((c) => c.t.slice(5));
  const data = recent.map((c) => c.c);
  const sma15Data = sma15Full
    .slice(visibleStart)
    .map((v) => (v == null ? null : Number(v.toFixed(4))));

  const first = data[0] ?? 0;
  const last = data[data.length - 1] ?? 0;
  const positive = last >= first;
  const lineColor = positive ? "rgb(22,163,74)" : "rgb(220,38,38)";

  // Plan overlay rendered as additional flat datasets (avoids the
  // annotation plugin which quickchart's default sandbox may not load).
  const datasets: Array<Record<string, unknown>> = [
    {
      label: ticker,
      data,
      borderColor: lineColor,
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.1,
    },
    {
      label: "SMA15",
      data: sma15Data,
      borderColor: "rgba(120,113,108,0.85)",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0.05,
      spanGaps: true,
    },
  ];

  if (plan) {
    const flat = (value: number, color: string, label: string) => ({
      label,
      data: data.map(() => value),
      borderColor: color,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderDash: [5, 3],
      pointRadius: 0,
    });
    datasets.push(flat(plan.entry, "rgb(37,99,235)", "Entry"));
    datasets.push(flat(plan.stop, "rgb(220,38,38)", "Stop"));
    datasets.push(flat(plan.target, "rgb(22,163,74)", "Target"));
  }

  const chart = {
    type: "line",
    data: { labels, datasets },
    options: {
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { font: { size: 9 }, boxWidth: 12 },
        },
        title: {
          display: true,
          text: `${ticker} · last ${recent.length} sessions · SMA15 dashed`,
          font: { size: 11 },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6, font: { size: 9 } } },
        y: { ticks: { font: { size: 9 } } },
      },
    },
  };

  try {
    const res = await fetch("https://quickchart.io/chart/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chart,
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
        backgroundColor: "white",
        version: "4",
      }),
    });
    if (!res.ok) {
      console.warn(
        `[slack] quickchart shortlink failed for ${ticker}: ${res.status}`,
      );
      return null;
    }
    const json = (await res.json()) as { success?: boolean; url?: string };
    if (!json.success || !json.url) return null;
    return json.url;
  } catch (e) {
    console.warn(
      `[slack] quickchart shortlink threw for ${ticker}: ${(e as Error).message}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public sender
// ---------------------------------------------------------------------------

export async function sendSlackDigest(
  fires: FireRecord[],
  picks: DigestPick[] = [],
): Promise<void> {
  if (fires.length === 0 && picks.length === 0) return;

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook || webhook.length === 0) {
    console.warn(
      `[slack] SLACK_WEBHOOK_URL unset — skipping. Would have sent ${fires.length} fire(s) + ${picks.length} pick(s).`,
    );
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const blocks: SlackBlock[] = [];

  const fireSection = fireBlocks(fires, appUrl);
  blocks.push(...fireSection);

  if (fireSection.length > 0 && picks.length > 0) {
    blocks.push({ type: "divider" });
  }

  // Build digest blocks in parallel (chart shortlinks fan out to quickchart).
  const digestBlocks = await pickBlocks(picks, appUrl);
  blocks.push(...digestBlocks);

  // GSD review M7: Slack rejects >50 blocks. Log when we truncate so
  // future-us can see when the digest started losing content silently.
  if (blocks.length > 50) {
    console.warn(
      `[slack] payload had ${blocks.length} blocks; truncated to Slack's 50-block limit.`,
    );
  }
  const payload: SlackPayload = { blocks: blocks.slice(0, 50) };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(
        `[slack] webhook POST failed: status=${res.status} body=${body} payload_size=${JSON.stringify(payload).length}`,
      );
    }
  } catch (e) {
    console.error(`[slack] webhook POST threw: ${(e as Error).message}`);
  }
}
