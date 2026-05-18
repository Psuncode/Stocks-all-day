import { getProvider } from "@/lib/data/provider";
import { runScan } from "@/lib/engine/scan";
import { fetchSpyCandles } from "@/lib/data/yahoo";
import type { ScanConfig } from "@/lib/types";

export const runtime = "nodejs";

function boolParam(v: string | null, def: boolean) {
  if (v == null) return def;
  return v === "1" || v.toLowerCase() === "true";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg: ScanConfig = {
    includeBlocked: boolParam(url.searchParams.get("includeBlocked"), false),
    allowEarningsTrades: boolParam(url.searchParams.get("allowEarnings"), false),
    decisionFilter: (url.searchParams.get("decision")?.toUpperCase() as any) ?? "ALL",
    whyBlockedOnly: boolParam(url.searchParams.get("whyBlockedOnly"), false),
    maxRows: (() => {
      const raw = Number(url.searchParams.get("maxRows") ?? 0);
      if (raw <= 0) return 0;
      return Math.max(10, raw);
    })(),
  };

  if (!['ALL','PASS','WATCH','TRADE'].includes(cfg.decisionFilter)) {
    cfg.decisionFilter = "ALL";
  }

  const provider = getProvider();
  const [universe, spy] = await Promise.all([provider.getUniverse(), fetchSpyCandles()]);

  if (universe.length === 0) {
    return Response.json({ error: "data_unavailable" }, { status: 503 });
  }

  const results = runScan(universe, cfg, spy);

  return Response.json({
    config: cfg,
    count: results.length,
    results,
    generatedAt: new Date().toISOString(),
  });
}

