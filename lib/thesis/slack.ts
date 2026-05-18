/**
 * Slack delivery for invalidation digests — design.md §7.
 *
 * One POST per cron run with all fires bulleted as a single Block Kit payload
 * (requirements.md §C.2.2). Alert-only mode: no message is sent when zero rules
 * fire (§C.2.3). Failures are logged and swallowed — no retries within a tick
 * (§C.2.5). When `SLACK_WEBHOOK_URL` is unset we log a warning rather than
 * throwing, so local dev without Slack configured still works end-to-end.
 */

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
    };

type SlackPayload = { blocks: SlackBlock[] };

function buildBlocks(fires: FireRecord[], appUrl: string): SlackBlock[] {
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

export async function sendSlackDigest(fires: FireRecord[]): Promise<void> {
  // Alert-only mode — no fires, no message.
  if (fires.length === 0) {
    return;
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook || webhook.length === 0) {
    console.warn(
      "[slack] SLACK_WEBHOOK_URL is unset — skipping Slack delivery. " +
        `${fires.length} fire(s) would have been sent.`,
    );
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const payload: SlackPayload = { blocks: buildBlocks(fires, appUrl) };

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
    console.error(
      `[slack] webhook POST threw: ${(e as Error).message}`,
    );
  }
}
