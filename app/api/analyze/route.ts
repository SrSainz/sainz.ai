import { NextRequest, NextResponse } from "next/server";
import { GeminiFoodResponse } from "@/lib/types";

export const runtime = "nodejs";
const DEFAULT_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"];
const ENV_MODEL_CHAIN = (process.env.GEMINI_MODEL_PREFERENCE ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || ENV_MODEL_CHAIN[0] || DEFAULT_MODEL_CHAIN[0];
const MODEL_FALLBACKS = [...ENV_MODEL_CHAIN, ...DEFAULT_MODEL_CHAIN];

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

type GeminiHttpErrorEnvelope = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
};

type GeminiCallError = {
  ok: false;
  error: string;
  statusCode: number;
  quotaExceeded: boolean;
  retryAfterSeconds: number | null;
  quotaScopes: string[];
  model: string;
};

const primaryPrompt = `Analiza esta imagen de comida.

Identifica todos los alimentos visibles.

Para cada alimento devuelve:
- name (en espanol)
- grams
- calories
- protein
- carbs
- fat
- confidence (0-100)

Reglas importantes:
- Devuelve SOLO JSON valido.
- Sin markdown.
- Si dudas de un alimento o porcion, baja confidence.
- Prioriza precision de gramos: evita redondear todo a 100g.
- Si aparece una unica pieza de fruta (por ejemplo un platano), usa gramos realistas de una unidad (aprox. 90-160 g comestibles).
- No inventes alimentos que no se ven.
- Si no hay alimentos visibles, devuelve "foods": [] y totales en 0.`;

const retryPrompt = `Responde de nuevo con JSON ESTRICTO.

Debes devolver SOLO este objeto JSON, sin texto extra:
{
  "foods": [
    {
      "name": "string",
      "grams": 0,
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "confidence": 0
    }
  ],
  "total_calories": 0,
  "total_protein": 0,
  "total_carbs": 0,
  "total_fat": 0
}

Usa nombres de alimentos en espanol y porciones realistas.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const body = (await req.json()) as { imageBase64?: string; mimeType?: string };
    const imageBase64 = (body.imageBase64 ?? "").trim();
    const mimeType = (body.mimeType ?? "image/jpeg").trim() || "image/jpeg";

    if (!imageBase64) {
      return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
    }

    let lastError = "Respuesta invalida del modelo.";
    let lastCallError: GeminiCallError | null = null;
    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const prompt = attempt === 0 ? primaryPrompt : retryPrompt;
      const parsed = await callGemini({ apiKey, imageBase64, mimeType, prompt });
      if (!parsed.ok) {
        lastError = parsed.error;
        lastCallError = parsed;
        if (parsed.quotaExceeded) break;
        if (shouldRetry(parsed.error) && attempt < maxRetries) continue;
        break;
      }

      const normalized = normalizeGeminiResponse(parsed.data);
      if (normalized.foods.length > 0) {
        return NextResponse.json({ ...normalized, source: "gemini", model: parsed.model });
      }
      lastError = "No se detectaron alimentos.";
    }

    const errorStatus = lastCallError?.quotaExceeded ? 429 : 502;
    const dailyResetSeconds = secondsUntilPacificMidnight(new Date());
    return NextResponse.json(
      {
        error: `Gemini no devolvio un resultado valido: ${lastError}`,
        quotaExceeded: lastCallError?.quotaExceeded ?? false,
        retryAfterSeconds: lastCallError?.retryAfterSeconds ?? null,
        quotaScopes: lastCallError?.quotaScopes ?? [],
        model: lastCallError?.model ?? null,
        modelCandidates: getModelCandidates(),
        dailyResetSeconds
      },
      { status: errorStatus }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function callGemini(input: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
}): Promise<{ ok: true; data: GeminiFoodResponse; model: string } | GeminiCallError> {
  let lastError = "Gemini no devolvio respuesta valida.";
  let lastCallError: GeminiCallError | null = null;

  for (const model of getModelCandidates()) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${input.apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            { text: input.prompt },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: input.imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: 900
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const rawText = await response.text();
    if (!response.ok) {
      const parsedError = parseGeminiApiError(rawText, response.status, model);
      lastError = parsedError.error;
      lastCallError = parsedError;
      if (parsedError.quotaExceeded || shouldTryNextModel(parsedError.error, response.status)) {
        continue;
      }
      return parsedError;
    }

    const envelope = safeJsonParse<GeminiGenerateResponse>(rawText);
    if (!envelope) {
      lastError = "Gemini devolvio un sobre JSON invalido.";
      continue;
    }

    const contentText = envelope.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text?.trim();
    if (!contentText) {
      lastError = "Gemini no devolvio contenido de texto.";
      continue;
    }

    const parsed = parseFoodJson(contentText);
    if (!parsed) {
      lastError = "Gemini devolvio texto no JSON.";
      continue;
    }

    return { ok: true, data: parsed, model };
  }

  return (
    lastCallError ?? {
      ok: false,
      error: lastError,
      statusCode: 502,
      quotaExceeded: false,
      retryAfterSeconds: null,
      quotaScopes: [],
      model: getModelCandidates()[0] ?? GEMINI_MODEL
    }
  );
}

function parseFoodJson(raw: string): GeminiFoodResponse | null {
  const cleaned = raw
    .replaceAll("```json", "")
    .replaceAll("```", "")
    .trim();

  const candidates = [raw, cleaned, extractJsonObject(cleaned)].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = safeJsonParse<GeminiFoodResponse>(candidate);
    if (parsed && Array.isArray(parsed.foods)) {
      return parsed;
    }
  }
  return null;
}

function normalizeGeminiResponse(input: GeminiFoodResponse): GeminiFoodResponse {
  const foods = (input.foods ?? [])
    .map((food) => ({
      name: cleanFoodName(String(food.name ?? "")),
      grams: clampNumber(food.grams, 0, 2000),
      calories: clampNumber(food.calories, 0, 5000),
      protein: clampNumber(food.protein, 0, 500),
      carbs: clampNumber(food.carbs, 0, 500),
      fat: clampNumber(food.fat, 0, 500),
      confidence: clampNumber(food.confidence, 0, 100)
    }))
    .filter((f) => f.name.length > 0);

  const sums = foods.reduce(
    (acc, f) => {
      acc.calories += f.calories;
      acc.protein += f.protein;
      acc.carbs += f.carbs;
      acc.fat += f.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    foods,
    total_calories: fallbackNumber(input.total_calories, sums.calories),
    total_protein: fallbackNumber(input.total_protein, sums.protein),
    total_carbs: fallbackNumber(input.total_carbs, sums.carbs),
    total_fat: fallbackNumber(input.total_fat, sums.fat)
  };
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseGeminiApiError(raw: string, statusCode: number, model: string): GeminiCallError {
  const parsed = safeJsonParse<GeminiHttpErrorEnvelope>(raw);
  const message = parsed?.error?.message?.trim() || `Gemini API HTTP ${statusCode}`;
  const status = parsed?.error?.status?.trim() || "";
  const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
  const retryAfterSeconds = extractRetryAfterSeconds(details);
  const quotaScopes = extractQuotaScopes(details);
  const quotaExceeded =
    statusCode === 429 ||
    status.toUpperCase() === "RESOURCE_EXHAUSTED" ||
    message.toLowerCase().includes("quota");

  return {
    ok: false,
    error: message,
    statusCode,
    quotaExceeded,
    retryAfterSeconds,
    quotaScopes,
    model
  };
}

function extractRetryAfterSeconds(details: Array<Record<string, unknown>>): number | null {
  for (const detail of details) {
    const typeUrl = String(detail["@type"] ?? "");
    if (!typeUrl.includes("google.rpc.RetryInfo")) continue;
    const retryDelay = String(detail.retryDelay ?? "");
    const match = retryDelay.match(/([\d.]+)s$/);
    if (!match) continue;
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds);
    }
  }
  return null;
}

function extractQuotaScopes(details: Array<Record<string, unknown>>): string[] {
  const scopes = new Set<string>();

  for (const detail of details) {
    const typeUrl = String(detail["@type"] ?? "");
    if (!typeUrl.includes("google.rpc.QuotaFailure")) continue;
    const violations = Array.isArray(detail.violations) ? detail.violations : [];
    for (const violation of violations) {
      const record = (violation ?? {}) as Record<string, unknown>;
      const quotaId = String(record.quotaId ?? "");
      const lower = quotaId.toLowerCase();
      if (lower.includes("perday") || lower.includes("daily")) scopes.add("day");
      if (lower.includes("perminute") || lower.includes("minute")) scopes.add("minute");
    }
  }

  return [...scopes];
}

function secondsUntilPacificMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const second = Number(parts.find((p) => p.type === "second")?.value ?? "0");
  const elapsed = hour * 3600 + minute * 60 + second;
  return Math.max(1, 86_400 - elapsed);
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function fallbackNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function cleanFoodName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^[-*.\d)\s]+/, "")
    .replace(/\s+/g, " ");
  return cleaned.slice(0, 80);
}

function shouldRetry(message: string): boolean {
  const check = message.toLowerCase();
  return (
    check.includes("no json") ||
    check.includes("no devolvio contenido") ||
    check.includes("invalido") ||
    check.includes("invalid") ||
    check.includes("429") ||
    check.includes("unavailable")
  );
}

function getModelCandidates(): string[] {
  const unique = new Set<string>();
  [GEMINI_MODEL, ...MODEL_FALLBACKS].forEach((model) => {
    if (model && model.trim()) unique.add(model.trim());
  });
  return [...unique];
}

function shouldTryNextModel(message: string, status: number): boolean {
  const check = message.toLowerCase();
  return (
    status === 404 ||
    check.includes("not found") ||
    check.includes("not supported") ||
    check.includes("unknown model") ||
    check.includes("is not found for api version")
  );
}
