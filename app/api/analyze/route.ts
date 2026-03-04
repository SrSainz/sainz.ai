import { NextRequest, NextResponse } from "next/server";
import { GeminiFoodResponse } from "@/lib/types";

export const runtime = "nodejs";

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

const prompt = `Analyze this food image.

Identify all visible food items.

For each food item:
- name
- estimated weight in grams
- estimated calories
- protein (g)
- carbs (g)
- fat (g)
- confidence (0-100%)

Return ONLY valid JSON in this format:

{
  "foods": [
    {
      "name": "",
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

Do not add explanations.
Be realistic with portion sizes.`;

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

    let lastError = "Invalid model response.";
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const parsed = await callGemini({ apiKey, imageBase64, mimeType });
      if (!parsed.ok) {
        lastError = parsed.error;
        if (shouldRetry(parsed.error) && attempt < maxRetries) continue;
        break;
      }

      const normalized = normalizeGeminiResponse(parsed.data);
      if (normalized.foods.length > 0) {
        return NextResponse.json(normalized);
      }
      lastError = "No foods detected.";
    }

    return NextResponse.json(safeFallback(lastError), { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json(safeFallback(message), { status: 200 });
  }
}

async function callGemini(input: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
}): Promise<{ ok: true; data: GeminiFoodResponse } | { ok: false; error: string }> {
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${input.apiKey}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: input.mimeType,
              data: input.imageBase64
            }
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const rawText = await response.text();
  if (!response.ok) {
    const bestError = tryExtractError(rawText) ?? `Gemini API HTTP ${response.status}`;
    return { ok: false, error: bestError };
  }

  const envelope = safeJsonParse<GeminiGenerateResponse>(rawText);
  if (!envelope) return { ok: false, error: "Gemini returned invalid JSON envelope." };

  const contentText = envelope.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text?.trim();
  if (!contentText) return { ok: false, error: "Gemini response has no text content." };

  const parsed = parseFoodJson(contentText);
  if (!parsed) return { ok: false, error: "Gemini returned non-JSON text." };

  return { ok: true, data: parsed };
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
      name: String(food.name ?? "").trim(),
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

function safeFallback(message: string): GeminiFoodResponse & { warning: string } {
  return {
    foods: [
      {
        name: "Estimated Meal",
        grams: 200,
        calories: 300,
        protein: 20,
        carbs: 30,
        fat: 10,
        confidence: 15
      }
    ],
    total_calories: 300,
    total_protein: 20,
    total_carbs: 30,
    total_fat: 10,
    warning: message
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

function tryExtractError(raw: string): string | null {
  const parsed = safeJsonParse<{ error?: { message?: string } }>(raw);
  return parsed?.error?.message?.trim() || null;
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

function shouldRetry(message: string): boolean {
  const check = message.toLowerCase();
  return (
    check.includes("non-json") ||
    check.includes("no text content") ||
    check.includes("invalid json")
  );
}
