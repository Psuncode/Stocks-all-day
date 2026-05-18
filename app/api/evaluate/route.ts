import { getProvider } from "@/lib/data/provider";
import { evaluateSymbol, todayYmd } from "@/lib/engine/evaluate";
import { fetchSpyCandles } from "@/lib/data/yahoo";

export const runtime = "nodejs";

type EvaluateRequest = {
  tickers: string[];
  allowEarnings?: boolean;
};

function boolish(v: unknown, def: boolean) {
  if (typeof v !== "boolean") return def;
  return v;
}

function normalizeTicker(t: string) {
  return t.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}

export async function POST(req: Request) {
  let body: EvaluateRequest;
  try {
    body = (await req.json()) as EvaluateRequest;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const rawTickers = Array.isArray(body.tickers) ? body.tickers : [];
  const tickers = Array.from(
    new Set(rawTickers.map((t) => (typeof t === "string" ? normalizeTicker(t) : "")).filter(Boolean)),
  ).slice(0, 200);

  if (tickers.length === 0) {
    return Response.json({ error: "missing_tickers" }, { status: 400 });
  }

  const allowEarnings = boolish(body.allowEarnings, false);

  const provider = getProvider();
  const [universe, spy] = await Promise.all([provider.getUniverse(), fetchSpyCandles()]);

  const found = new Map<string, any>();
  for (const u of universe) found.set(u.meta.ticker.toUpperCase(), u);

  const asOf = todayYmd();
  const results = [] as any[];
  const notFound: string[] = [];

  for (const t of tickers) {
    let symbol = found.get(t);
    if (!symbol) {
      symbol = await provider.getSymbol(t);
      if (!symbol) {
        notFound.push(t);
        continue;
      }
    }
    results.push(evaluateSymbol(symbol, universe, { allowEarningsTrades: allowEarnings }, asOf, spy));
  }

  return Response.json({
    allowEarnings,
    count: results.length,
    results,
    notFound,
    generatedAt: new Date().toISOString(),
  });
}

