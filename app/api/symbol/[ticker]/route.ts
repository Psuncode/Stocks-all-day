import { getProvider } from "@/lib/data/provider";
import { evaluateSymbol, todayYmd } from "@/lib/engine/evaluate";
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

  const result = evaluateSymbol(
    symbol,
    universe,
    { allowEarningsTrades: allowEarnings },
    todayYmd(),
    spy,
  );

  return Response.json({ result, generatedAt: new Date().toISOString() });
}

