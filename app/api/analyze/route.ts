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

type VisionFoodItem = {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  is_packaged?: boolean;
  brand?: string;
  product_name?: string;
  barcode?: string;
  nutrition_source?: "ai" | "db" | "product";
};

type VisionFoodResponse = {
  foods: VisionFoodItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
};

type OpenFoodFactsProduct = {
  product_name?: string;
  product_name_es?: string;
  brands?: string;
  quantity?: string;
  nutriments?: Record<string, unknown>;
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
- is_packaged (true/false)
- brand (si se ve marca)
- product_name (si es producto envasado y se lee en etiqueta)
- barcode (solo digitos si se lee)

Reglas importantes:
- Devuelve SOLO JSON valido.
- Sin markdown.
- Si dudas de un alimento o porcion, baja confidence.
- Prioriza precision de gramos: evita redondear todo a 100g.
- Si hay un producto envasado, intenta leer texto de etiqueta y marca.
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
      "confidence": 0,
      "is_packaged": false,
      "brand": "",
      "product_name": "",
      "barcode": ""
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
      const enriched = await enrichPackagedFoodsWithOpenFoodFacts(normalized);
      if (enriched.foods.length > 0) {
        return NextResponse.json({
          ...toPublicGeminiResponse(enriched),
          source: "gemini",
          model: parsed.model,
          warning: enriched.warning ?? undefined,
          packagedEnriched: enriched.packagedEnriched
        });
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
}): Promise<{ ok: true; data: VisionFoodResponse; model: string } | GeminiCallError> {
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

function parseFoodJson(raw: string): VisionFoodResponse | null {
  const cleaned = raw
    .replaceAll("```json", "")
    .replaceAll("```", "")
    .trim();

  const candidates = [raw, cleaned, extractJsonObject(cleaned)].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = safeJsonParse<VisionFoodResponse>(candidate);
    if (parsed && Array.isArray(parsed.foods)) {
      return parsed;
    }
  }
  return null;
}

function normalizeGeminiResponse(input: VisionFoodResponse): VisionFoodResponse {
  const foods = (input.foods ?? [])
    .map((food) => ({
      name: cleanFoodName(String(food.name ?? "")),
      product_name: cleanFoodName(String(food.product_name ?? "")),
      brand: cleanFoodName(String(food.brand ?? "")),
      barcode: cleanBarcode(String(food.barcode ?? "")),
      grams: clampNumber(food.grams, 0, 2000),
      calories: clampNumber(food.calories, 0, 5000),
      protein: clampNumber(food.protein, 0, 500),
      carbs: clampNumber(food.carbs, 0, 500),
      fat: clampNumber(food.fat, 0, 500),
      confidence: clampNumber(food.confidence, 0, 100),
      is_packaged: Boolean(food.is_packaged),
      nutrition_source: "ai" as const
    }))
    .filter((f) => f.name.length > 0 || f.product_name.length > 0);

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

async function enrichPackagedFoodsWithOpenFoodFacts(input: VisionFoodResponse): Promise<{
  foods: VisionFoodItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  warning?: string;
  packagedEnriched: number;
}> {
  const foods = [...(input.foods ?? [])];
  if (!foods.length) {
    return { ...input, packagedEnriched: 0 };
  }

  let packagedEnriched = 0;
  let packagedDetected = 0;
  const maxLookups = 4;
  let lookups = 0;

  for (let idx = 0; idx < foods.length; idx += 1) {
    if (lookups >= maxLookups) break;
    const current = foods[idx];
    const query = packagedLookupQuery(current);
    if (!query) continue;

    packagedDetected += 1;
    lookups += 1;

    const product = await fetchOpenFoodFactsProduct(query);
    if (!product) continue;

    const nutrition100 = extractNutritionPer100(product.nutriments);
    if (!nutrition100) continue;

    const grams = choosePackagedPortionGrams(current, product);
    foods[idx] = {
      ...current,
      name: cleanFoodName(product.product_name_es || product.product_name || current.product_name || current.name),
      product_name: cleanFoodName(product.product_name_es || product.product_name || current.product_name || current.name),
      brand: cleanFoodName(product.brands || current.brand || ""),
      grams,
      calories: scalePer100(nutrition100.calories, grams),
      protein: scalePer100(nutrition100.protein, grams),
      carbs: scalePer100(nutrition100.carbs, grams),
      fat: scalePer100(nutrition100.fat, grams),
      confidence: Math.max(current.confidence, 95),
      is_packaged: true,
      nutrition_source: "product"
    };
    packagedEnriched += 1;
  }

  const totals = foods.reduce(
    (acc, food) => {
      acc.calories += clampNumber(food.calories, 0, 5000);
      acc.protein += clampNumber(food.protein, 0, 500);
      acc.carbs += clampNumber(food.carbs, 0, 500);
      acc.fat += clampNumber(food.fat, 0, 500);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const warning =
    packagedDetected > 0 && packagedEnriched === 0
      ? "Se detectaron productos envasados, pero no se pudo validar nutricion exacta con base externa."
      : undefined;

  return {
    foods,
    total_calories: totals.calories,
    total_protein: totals.protein,
    total_carbs: totals.carbs,
    total_fat: totals.fat,
    warning,
    packagedEnriched
  };
}

function packagedLookupQuery(food: VisionFoodItem): { type: "barcode"; value: string } | { type: "text"; value: string } | null {
  const barcode = cleanBarcode(String(food.barcode ?? ""));
  if (barcode.length >= 8) {
    return { type: "barcode", value: barcode };
  }

  const byModel = Boolean(food.is_packaged) || looksLikePackagedName(food.name) || looksLikePackagedName(food.product_name ?? "");
  if (!byModel) return null;
  const text = `${food.brand ?? ""} ${food.product_name ?? food.name}`.trim();
  if (!text) return null;
  return { type: "text", value: text };
}

function looksLikePackagedName(name: string): boolean {
  const key = cleanFoodName(name).toLowerCase();
  if (!key) return false;
  return (
    key.includes("zero") ||
    key.includes("cola") ||
    key.includes("kellogg") ||
    key.includes("cereal") ||
    key.includes("monster") ||
    key.includes("red bull") ||
    key.includes("yogur") ||
    key.includes("galleta") ||
    key.includes("snack")
  );
}

async function fetchOpenFoodFactsProduct(
  query: { type: "barcode"; value: string } | { type: "text"; value: string }
): Promise<OpenFoodFactsProduct | null> {
  try {
    if (query.type === "barcode") {
      const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(query.value)}.json`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return null;
      const parsed = (await response.json()) as { status?: number; product?: OpenFoodFactsProduct };
      if (parsed.status !== 1 || !parsed.product) return null;
      return parsed.product;
    }

    const searchUrl = new URL("https://world.openfoodfacts.org/cgi/search.pl");
    searchUrl.searchParams.set("search_terms", query.value);
    searchUrl.searchParams.set("search_simple", "1");
    searchUrl.searchParams.set("action", "process");
    searchUrl.searchParams.set("json", "1");
    searchUrl.searchParams.set("page_size", "5");

    const response = await fetch(searchUrl.toString(), { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { products?: OpenFoodFactsProduct[] };
    const products = Array.isArray(parsed.products) ? parsed.products : [];
    const firstWithNutrition = products.find((p) => extractNutritionPer100(p.nutriments));
    return firstWithNutrition ?? null;
  } catch {
    return null;
  }
}

function extractNutritionPer100(nutriments: Record<string, unknown> | undefined): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} | null {
  if (!nutriments) return null;

  const calories = readNutriment(nutriments, ["energy-kcal_100g", "energy_kcal_100g", "energy-kcal_100ml", "energy_kcal_100ml"]);
  const protein = readNutriment(nutriments, ["proteins_100g", "proteins_100ml"]);
  const carbs = readNutriment(nutriments, ["carbohydrates_100g", "carbohydrates_100ml"]);
  const fat = readNutriment(nutriments, ["fat_100g", "fat_100ml"]);

  if (calories === null || protein === null || carbs === null || fat === null) return null;

  return {
    calories: clampNumber(calories, 0, 900),
    protein: clampNumber(protein, 0, 100),
    carbs: clampNumber(carbs, 0, 100),
    fat: clampNumber(fat, 0, 100)
  };
}

function readNutriment(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function choosePackagedPortionGrams(food: VisionFoodItem, product: OpenFoodFactsProduct): number {
  const fromFood = clampNumber(food.grams, 0, 2000);
  if (fromFood > 0) return fromFood;

  const quantity = parseQuantityToGrams(product.quantity ?? "");
  if (quantity > 0) return clampNumber(quantity, 20, 2000);

  return 100;
}

function parseQuantityToGrams(raw: string): number {
  const normalized = String(raw ?? "")
    .toLowerCase()
    .replace(",", ".")
    .trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(ml|cl|l|g|kg)\b/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = match[2];
  if (unit === "ml") return amount;
  if (unit === "cl") return amount * 10;
  if (unit === "l") return amount * 1000;
  if (unit === "g") return amount;
  if (unit === "kg") return amount * 1000;
  return 0;
}

function scalePer100(valuePer100: number, grams: number): number {
  return valuePer100 * (Math.max(0, grams) / 100);
}

function toPublicGeminiResponse(input: VisionFoodResponse): GeminiFoodResponse & { foods: VisionFoodItem[] } {
  return {
    foods: input.foods.map((food) => ({
      name: food.product_name || food.name,
      grams: food.grams,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      confidence: food.confidence,
      is_packaged: food.is_packaged,
      brand: food.brand,
      product_name: food.product_name,
      barcode: food.barcode,
      nutrition_source: food.nutrition_source
    })),
    total_calories: input.total_calories,
    total_protein: input.total_protein,
    total_carbs: input.total_carbs,
    total_fat: input.total_fat
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

function cleanBarcode(value: string): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 20);
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
