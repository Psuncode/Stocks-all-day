/**
 * Trade journal API (v4.0 T2).
 *
 * GET    /api/journal          → { trades, stats, kv }     (graceful degrade)
 * POST   /api/journal          → add a trade (NewTradeInput)
 * PUT    /api/journal?id=<id>  → patch a trade (UpdateTradeInput, partial)
 * DELETE /api/journal?id=<id>  → remove a trade
 *
 * Auth model — single-user personal tool:
 *   - GET/POST/PUT are open (mirrors /api/watch).
 *   - DELETE requires `Authorization: Bearer <CRON_SECRET>` in production as
 *     defense-in-depth on the destructive endpoint. Dev (no CRON_SECRET) is
 *     unsigned to keep curl testing trivial.
 *
 * If this app ever becomes multi-user, gate POST/PUT with the same Bearer
 * pattern (and namespace the KV keys by user-id).
 */
import {
  addTrade,
  loadJournal,
  removeTrade,
  updateTrade,
} from "@/lib/journal/archive";
import { kvAvailable } from "@/lib/data/kv";
import {
  NewTradeInput,
  UpdateTradeInput,
  type DerivedStats,
} from "@/lib/journal/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZERO_STATS: DerivedStats = {
  n: 0,
  openN: 0,
  closedN: 0,
  closedWithRn: 0,
  winRate: 0,
  avgR: 0,
  totalPnL: 0,
  expectancy: 0,
  bySetup: {},
};

// ---------------------------------------------------------------------------
// GET — list + stats. Graceful degrade when KV is unavailable.
// ---------------------------------------------------------------------------
export async function GET(): Promise<Response> {
  if (!kvAvailable()) {
    return Response.json({ trades: [], stats: ZERO_STATS, kv: false });
  }
  const { trades, stats } = await loadJournal();
  return Response.json({ trades, stats, kv: true });
}

// ---------------------------------------------------------------------------
// POST — create. Body = NewTradeInput.
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
  if (!kvAvailable()) {
    return Response.json(
      { ok: false, reason: "kv_unavailable" },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const parsed = NewTradeInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const reason = issue
      ? `${issue.path.join(".") || "(root)"}: ${issue.message}`
      : "invalid";
    return Response.json({ ok: false, reason }, { status: 400 });
  }

  const result = await addTrade(parsed.data);
  if (!result.ok) {
    const status = result.reason === "kv_unavailable" ? 503 : 400;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  return Response.json({ ok: true, trade: result.data });
}

// ---------------------------------------------------------------------------
// PUT — update via ?id=. Body = UpdateTradeInput (partial).
// ---------------------------------------------------------------------------
export async function PUT(req: Request): Promise<Response> {
  if (!kvAvailable()) {
    return Response.json(
      { ok: false, reason: "kv_unavailable" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json(
      { ok: false, reason: "missing_id" },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const parsed = UpdateTradeInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const reason = issue
      ? `${issue.path.join(".") || "(root)"}: ${issue.message}`
      : "invalid";
    return Response.json({ ok: false, reason }, { status: 400 });
  }

  const result = await updateTrade(id, parsed.data);
  if (!result.ok) {
    let status = 400;
    if (result.reason === "kv_unavailable") status = 503;
    else if (result.reason === "not_found") status = 404;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  return Response.json({ ok: true, trade: result.data });
}

// ---------------------------------------------------------------------------
// DELETE — remove via ?id=. CRON_SECRET-gated in production.
// ---------------------------------------------------------------------------
export async function DELETE(req: Request): Promise<Response> {
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  const secret = process.env.CRON_SECRET;

  if (isProd) {
    // Fail-closed in prod: even if CRON_SECRET is unset (misconfig), refuse.
    if (!secret) {
      console.error(
        "[journal] CRON_SECRET unset in production — refusing DELETE",
      );
      return Response.json(
        { ok: false, reason: "misconfigured" },
        { status: 500 },
      );
    }
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json(
        { ok: false, reason: "unauthorized" },
        { status: 401 },
      );
    }
  }
  // Dev: pass through unsigned. (Matches /api/check-invalidations behavior.)

  if (!kvAvailable()) {
    return Response.json(
      { ok: false, reason: "kv_unavailable" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json(
      { ok: false, reason: "missing_id" },
      { status: 400 },
    );
  }

  const result = await removeTrade(id);
  if (!result.ok) {
    const status = result.reason === "kv_unavailable" ? 503 : 400;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  return Response.json({ ok: true, id: result.data.id });
}
