import { getProvider } from "@/lib/data/provider";
import {
  buildSectorRsMap,
  evaluateSymbol,
  todayYmd,
} from "@/lib/engine/evaluate";
import { fetchSpyCandles } from "@/lib/data/yahoo";

export const runtime = "nodejs";

function boolParam(v: string | null, def: boolean) {
  if (v == null) return def;
  return v === "1" || v.toLowerCase() === "true";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const url = new URL(req.url);
  const allowEarnings = boolParam(url.searchParams.get("allowEarnings"), false);

  const provider = getProvider();
  const [universe, spy, symbol] = await Promise.all([
    provider.getUniverse(),
    fetchSpyCandles(),
    provider.getSymbol(ticker),
  ]);

  if (!symbol) {
    return Response.json(
      { error: "not_found", message: `No symbol named \"${ticker}\".` },
      { status: 404 },
    );
  }

  // GSD review pass 2 H3.5: precompute sector RS once so the EVENT gate
  // doesn't recompute deriveMetrics for every same-sector peer on every
  // Drawer click in the scanner.
  const sectorRsByName = buildSectorRsMap(universe, spy);
  const result = evaluateSymbol(
    symbol,
    universe,
    { allowEarningsTrades: allowEarnings },
    todayYmd(),
    spy,
    sectorRsByName,
  );

  return Response.json({ result, generatedAt: new Date().toISOString() });
}

