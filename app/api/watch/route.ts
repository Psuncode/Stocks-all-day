/**
 * Quick-watch toggle API (Feature F).
 *
 * GET  /api/watch         → { tickers: string[] }  (current quick-watch set)
 * POST /api/watch         → toggle (body { ticker, name, sector, decision, setup })
 *   - if not in set: adds with metadata
 *   - if already in set: removes (returns { added: false, removed: true })
 *
 * No auth — single-user personal tool. If you ever expose this app to
 * multiple users, gate this route + the KV namespace.
 */

import {
  toggleQuickWatch,
  listQuickWatch,
} from "@/lib/watch/quick-watch";
import { kvAvailable } from "@/lib/data/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ToggleBody = {
  ticker: string;
  name?: string;
  sector?: string;
  decision?: string;
  setup?: string;
};

export async function GET(): Promise<Response> {
  if (!kvAvailable()) {
    return Response.json({ tickers: [], entries: [], kv: false });
  }
  const entries = await listQuickWatch();
  return Response.json({
    tickers: entries.map((e) => e.ticker),
    entries,
    kv: true,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!kvAvailable()) {
    return Response.json(
      { ok: false, reason: "kv_unavailable" },
      { status: 503 },
    );
  }

  let body: ToggleBody;
  try {
    body = (await req.json()) as ToggleBody;
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!ticker) {
    return Response.json(
      { ok: false, reason: "missing_ticker" },
      { status: 400 },
    );
  }

  const result = await toggleQuickWatch({
    ticker,
    name: body.name ?? ticker,
    sector: body.sector ?? "—",
    decision_at_add: body.decision ?? "—",
    setup_at_add: body.setup ?? "NONE",
  });
  return Response.json({
    ok: result.ok,
    action: result.action,
    ticker,
    reason: result.reason,
  });
}
