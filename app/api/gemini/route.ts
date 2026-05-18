export const runtime = "nodejs";

type GeminiRequest = {
  prompt: string;
  context?: unknown;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

function safeJson(value: unknown, maxChars: number) {
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + "…";
  } catch {
    return "";
  }
}

function readTextFromGeminiResponse(json: any): string {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: "not_configured",
        message: "Set GEMINI_API_KEY on the server to enable Gemini.",
      },
      { status: 501 },
    );
  }

  let body: GeminiRequest;
  try {
    body = (await req.json()) as GeminiRequest;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (prompt.length === 0) {
    return Response.json({ error: "missing_prompt" }, { status: 400 });
  }
  if (prompt.length > 20_000) {
    return Response.json({ error: "prompt_too_large" }, { status: 413 });
  }

  const model =
    (body.model ?? process.env.GEMINI_MODEL ?? "gemini-1.5-flash").trim() || "gemini-1.5-flash";
  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(2, Math.max(0, body.temperature))
      : 0.4;
  const maxOutputTokens =
    typeof body.maxOutputTokens === "number" && Number.isFinite(body.maxOutputTokens)
      ? Math.min(2048, Math.max(64, Math.floor(body.maxOutputTokens)))
      : 512;

  const contextJson = body.context ? safeJson(body.context, 18_000) : "";
  const fullPrompt =
    contextJson.length > 0
      ? `${prompt}\n\nContext (JSON):\n${contextJson}`
      : prompt;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: fullPrompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    }),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return Response.json(
      {
        error: "gemini_error",
        status: upstream.status,
        details: text.slice(0, 5_000),
      },
      { status: 502 },
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad_upstream_json" }, { status: 502 });
  }

  const out = readTextFromGeminiResponse(json);
  if (!out) {
    return Response.json(
      {
        error: "empty_response",
        raw: json,
      },
      { status: 502 },
    );
  }

  return Response.json({
    model,
    text: out,
    generatedAt: new Date().toISOString(),
  });
}

