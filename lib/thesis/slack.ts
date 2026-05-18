/**
 * Slack delivery — invalidations (Feature C) + daily digest (Feature D).
 *
 * ONE webhook POST per cron run (requirements.md §C.2.2). Combined message:
 * invalidations first (if any), then "📊 Today's 5" section with per-pick
 * Block Kit sections + quickchart.io image blocks. No retry on failure.
 */

import type { DigestPick } from "@/lib/digest/build";

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

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function fireBlocks(fires: FireRecord[], appUrl: string): SlackBlock[] {
  if (fires.length === 0) return [];
  const plural = fires.length > 1 ? "s" : "";
  const nowEpoch = Math.floor(Date.now() / 1000);

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🔥 ${fires.length} invalidation${plural} fired`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<!date^${nowEpoch}^{date_pretty} · {time}|now>`,
        },
      ],
    },
    { type: "divider" },
  ];

  for (const fire of fires) {
    const tickerLink = `*<${appUrl}/symbol/${fire.ticker}|${fire.ticker}>*`;
    const label = fire.description ?? fire.rule_id;
    const text =
      `${tickerLink}` +
      `\n${label}` +
      `\nObserved: \`${fire.observed}\` · Threshold: \`${fire.threshold}\``;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });
  }

  return blocks;
}

function pickBlocks(picks: DigestPick[], appUrl: string): SlackBlock[] {
  if (picks.length === 0) return [];
  const nowEpoch = Math.floor(Date.now() / 1000);

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
          text: `<!date^${nowEpoch}^{date_pretty}|today> · engine-ranked candidates`,
        },
      ],
    },
  ];

  for (const pick of picks) {
    const r = pick.result;
    const tickerLink = `*<${appUrl}/symbol/${r.ticker}|${r.ticker}>*`;
    const decisionTag = r.decision === "TRADE" ? "⭐ TRADE" : "WATCH";
    const setup = r.gateSummary.setup === "NONE"
      ? ""
      : ` · ${r.gateSummary.setup.toLowerCase().replace("_", " ")}`;
    const planLine = r.plan
      ? `\n_Entry $${r.plan.entry} · Stop $${r.plan.stop} · Target $${r.plan.target} · R:R ${r.plan.rr}x_`
      : "";
    const sectorBit = r.sector ? ` · ${r.sector}` : "";
    const text =
      `${tickerLink} · ${decisionTag}${setup}${sectorBit}` +
      `\n${r.reason}` +
      planLine;

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });

    const chart = chartUrl(r.ticker, pick.candles, r.plan);
    if (chart) {
      blocks.push({
        type: "image",
        image_url: chart,
        alt_text: `${r.ticker} 90-day price`,
      });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// quickchart.io URL builder
// ---------------------------------------------------------------------------

function chartUrl(
  ticker: string,
  candles: Array<{ t: string; c: number }>,
  plan?: { entry: number; stop: number; target: number },
): string | null {
  if (candles.length < 2) return null;
  const labels = candles.map((c) => c.t.slice(5)); // MM-DD
  const data = candles.map((c) => c.c);
  const last = data[data.length - 1] ?? 0;
  const first = data[0] ?? 0;
  const lineColor = last >= first ? "#16a34a" : "#dc2626";

  const annotations: Record<string, unknown> = {};
  if (plan) {
    annotations.entry = horizontalLine(plan.entry, "#2563eb", "Entry");
    annotations.stop = horizontalLine(plan.stop, "#dc2626", "Stop");
    annotations.target = horizontalLine(plan.target, "#16a34a", "Target");
  }

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: ticker,
          data,
          borderColor: lineColor,
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${ticker} · last ${candles.length} sessions` },
        annotation: plan ? { annotations } : undefined,
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 9 } } },
        y: { ticks: { font: { size: 9 } } },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=240&backgroundColor=white`;
}

function horizontalLine(value: number, color: string, label: string) {
  return {
    type: "line",
    yMin: value,
    yMax: value,
    borderColor: color,
    borderWidth: 1,
    borderDash: [6, 3],
    label: {
      enabled: true,
      content: `${label} ${value}`,
      position: "end",
      font: { size: 9 },
      backgroundColor: color,
      color: "#fff",
    },
  };
}

// ---------------------------------------------------------------------------
// Public sender — one POST, fires + picks combined
// ---------------------------------------------------------------------------

export async function sendSlackDigest(
  fires: FireRecord[],
  picks: DigestPick[] = [],
): Promise<void> {
  // Skip entirely if there's nothing to say.
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

  blocks.push(...pickBlocks(picks, appUrl));

  // Slack has a 50-block limit per message. With up to 5 picks × 2 blocks each
  // = 10 + intro headers ≈ 14 blocks. Plus fires (up to ~5 typically). Safe.
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
        `[slack] webhook POST failed: status=${res.status} body=${body}`,
      );
    }
  } catch (e) {
    console.error(`[slack] webhook POST threw: ${(e as Error).message}`);
  }
}
