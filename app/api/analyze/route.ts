import { NextRequest, NextResponse } from "next/server";
import { GeminiFoodResponse } from "@/lib/types";
import { hasKnownFoodMatch, lookupNutrition } from "@/lib/nutrition-db";

export const runtime = "nodejs";
const DEFAULT_MODEL_CHAIN = [
  "gemini-2.5-pro",
  "gemini-2.5-pro-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash"
];
const API_VERSIONS = ["v1", "v1beta"] as const;
const GEMINI_TIMEOUT_MS = 16_000;
const OFF_TIMEOUT_MS = 5_000;
const MODEL_BACKOFF_DEFAULT_MS = 2 * 60 * 1000;
const MODEL_BACKOFF_UNSUPPORTED_MS = 12 * 60 * 60 * 1000;
const MODEL_BACKOFF_TIMEOUT_MS = 90 * 1000;
const modelBackoffUntil = new Map<string, number>();
const MODEL_PRIORITY_HINTS: Array<{ token: string; score: number }> = [
  { token: "2.5-pro", score: 1200 },
  { token: "2.0-pro", score: 1120 },
  { token: "2.5-flash", score: 1000 },
  { token: "2.0-flash", score: 920 },
  { token: "1.5-flash", score: 830 },
  { token: "flash-lite", score: 740 },
  { token: "lite", score: 700 }
];
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
- grams (si es bebida, usa volumen en ml y escribe ese numero en grams)
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
- Frutas enteras (mandarina, naranja, platano, manzana, etc.) cuentan como comida valida y deben detectarse.
- Si hay varias piezas iguales, puedes agruparlas en un solo item (ej: "Mandarina").
- Si aparece una unica pieza de fruta (por ejemplo un platano), usa gramos realistas de una unidad (aprox. 90-160 g comestibles).
- Si se ve al menos un alimento o bebida probable, devuelve al menos 1 item con confianza baja antes de responder foods vacio.
- No inventes alimentos que no se ven.
- Si no hay alimentos visibles, devuelve "foods": [] y totales en 0.

Formato obligatorio:
{
  "foods": [
    {
      "name": "",
      "grams": 0,
      "confidence": 0,
      "is_packaged": false,
      "brand": "",
      "product_name": "",
      "barcode": ""
    }
  ]
}`;

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

Usa nombres de alimentos en espanol y porciones realistas. Si es bebida, usa ml y escribe ese valor en grams. Si hay indicios de comida/bebida, evita foods vacio y responde con baja confianza.`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { imageBase64?: string; mimeType?: string; barcodeHint?: string };
    const imageBase64 = (body.imageBase64 ?? "").trim();
    const mimeType = normalizeMimeType(body.mimeType);
    const barcodeHint = cleanBarcode(String(body.barcodeHint ?? ""));

    if (!imageBase64) {
      return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
    }

    // If we already have a readable barcode from camera, prefer exact product lookup.
    if (barcodeHint.length >= 8) {
      const product = await fetchOpenFoodFactsProduct({ type: "barcode", value: barcodeHint });
      const nutrition100 = extractNutritionPer100(product?.nutriments);
      if (product && nutrition100) {
        const grams = clampNumber(parseQuantityToGrams(product.quantity ?? "") || 100, 20, 2000);
        const productName = cleanFoodName(product.product_name_es || product.product_name || "Producto envasado");
        const food: VisionFoodItem = {
          name: productName,
          product_name: productName,
          brand: cleanFoodName(product.brands || ""),
          barcode: barcodeHint,
          grams,
          calories: scalePer100(nutrition100.calories, grams),
          protein: scalePer100(nutrition100.protein, grams),
          carbs: scalePer100(nutrition100.carbs, grams),
          fat: scalePer100(nutrition100.fat, grams),
          confidence: 99,
          is_packaged: true,
          nutrition_source: "product"
        };
        const response: VisionFoodResponse = {
          foods: [food],
          total_calories: food.calories,
          total_protein: food.protein,
          total_carbs: food.carbs,
          total_fat: food.fat
        };
        return NextResponse.json({
          ...toPublicGeminiResponse(response),
          source: "openfoodfacts",
          model: "barcode",
          warning: "Producto identificado por codigo de barras. Valores tomados de base externa.",
          packagedEnriched: 1
        });
      }
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      const dailyResetSeconds = secondsUntilPacificMidnight(new Date());
      return NextResponse.json(
        {
          error: "Falta GEMINI_API_KEY. Configurala para analizar imagenes sin codigo de barras.",
          quotaExceeded: false,
          retryAfterSeconds: null,
          quotaScopes: [],
          model: null,
          modelCandidates: getModelCandidates(),
          dailyResetSeconds
        },
        { status: 503 }
      );
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
      const nutrified = await enrichFoodsWithNutritionPipeline(enriched, apiKey);
      if (nutrified.foods.length > 0) {
        return NextResponse.json({
          ...toPublicGeminiResponse(nutrified),
          source: "gemini",
          model: parsed.model,
          warning: nutrified.warning ?? undefined,
          packagedEnriched: nutrified.packagedEnriched
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
    for (const apiVersion of API_VERSIONS) {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(model)}:generateContent?key=${input.apiKey}`;
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

      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            cache: "no-store"
          },
          timeoutForModel(model)
        );
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === "AbortError";
        lastError = isTimeout ? "Timeout al contactar con Gemini." : "Error de red al contactar con Gemini.";
        lastCallError = {
          ok: false,
          error: lastError,
          statusCode: 504,
          quotaExceeded: false,
          retryAfterSeconds: null,
          quotaScopes: [],
          model
        };
        setModelBackoff(model, MODEL_BACKOFF_TIMEOUT_MS);
        continue;
      }

      const rawText = await response.text();
      if (!response.ok) {
        const parsedError = parseGeminiApiError(rawText, response.status, model);
        lastError = parsedError.error;
        lastCallError = parsedError;
        if (parsedError.quotaExceeded) {
          const dailyQuota = parsedError.quotaScopes.includes("day");
          const retryMs = dailyQuota
            ? secondsUntilPacificMidnight(new Date()) * 1000
            : parsedError.retryAfterSeconds
              ? parsedError.retryAfterSeconds * 1000
              : MODEL_BACKOFF_DEFAULT_MS;
          setModelBackoff(model, retryMs);
        } else if (shouldTryNextModel(parsedError.error, response.status)) {
          setModelBackoff(model, MODEL_BACKOFF_UNSUPPORTED_MS);
        } else {
          setModelBackoff(model, MODEL_BACKOFF_DEFAULT_MS);
        }
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

      const contentText = collectGeminiText(envelope);
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

  const candidates = [raw, cleaned, extractJsonObject(cleaned), extractJsonArray(cleaned)].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = safeJsonParse<unknown>(candidate);
    if (!parsed) continue;
    const coerced = coerceVisionFoodResponse(parsed);
    if (coerced) {
      return coerced;
    }
  }
  return null;
}

function coerceVisionFoodResponse(input: unknown): VisionFoodResponse | null {
  const root = asRecord(input);

  let foodsRaw: unknown[] = [];
  if (Array.isArray(input)) {
    foodsRaw = input;
  } else if (root) {
    const directFoods = pickArray(root, ["foods", "alimentos", "items", "food_items"]);
    if (directFoods) {
      foodsRaw = directFoods;
    } else {
      const data = asRecord(root.data);
      const nestedFoods = data ? pickArray(data, ["foods", "alimentos", "items", "food_items", "detected_foods"]) : null;
      if (nestedFoods) {
        foodsRaw = nestedFoods;
      } else {
        const result = asRecord(root.result) ?? asRecord(root.output) ?? asRecord(root.response);
        const resultFoods = result ? pickArray(result, ["foods", "alimentos", "items", "food_items", "detected_foods"]) : null;
        if (resultFoods) {
          foodsRaw = resultFoods;
        }
      }
    }
  }

  // Some models return a single food object at root instead of `foods: []`.
  if (!foodsRaw.length && root) {
    const singleton = coerceVisionFoodItem(root);
    if (singleton) foodsRaw = [root];
  }

  const foods = foodsRaw.map((item) => coerceVisionFoodItem(item)).filter(Boolean) as VisionFoodItem[];
  if (!foods.length) return null;

  const totalsFromInput = root
    ? {
        calories: readNumberFromKeys(root, ["total_calories", "totalCalories", "calories_total", "kcal_total"]),
        protein: readNumberFromKeys(root, ["total_protein", "totalProtein", "protein_total"]),
        carbs: readNumberFromKeys(root, ["total_carbs", "totalCarbs", "carbs_total"]),
        fat: readNumberFromKeys(root, ["total_fat", "totalFat", "fat_total"])
      }
    : null;

  const sums = foods.reduce(
    (acc, food) => {
      acc.calories += clampNumber(food.calories, 0, 5000);
      acc.protein += clampNumber(food.protein, 0, 500);
      acc.carbs += clampNumber(food.carbs, 0, 500);
      acc.fat += clampNumber(food.fat, 0, 500);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    foods,
    total_calories: fallbackNumber(totalsFromInput?.calories, sums.calories),
    total_protein: fallbackNumber(totalsFromInput?.protein, sums.protein),
    total_carbs: fallbackNumber(totalsFromInput?.carbs, sums.carbs),
    total_fat: fallbackNumber(totalsFromInput?.fat, sums.fat)
  };
}

function coerceVisionFoodItem(input: unknown): VisionFoodItem | null {
  if (typeof input === "string") {
    const rawName = cleanFoodName(input);
    if (!rawName) return null;
    return {
      name: rawName,
      grams: 100,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 60,
      is_packaged: false,
      brand: "",
      product_name: "",
      barcode: "",
      nutrition_source: "ai"
    };
  }

  const row = asRecord(input);
  if (!row) return null;

  const name = readStringFromKeys(row, ["name", "food", "item", "alimento", "product_name", "producto"]);
  const productName = readStringFromKeys(row, ["product_name", "productName", "producto", "nombre_producto"]);
  const brand = readStringFromKeys(row, ["brand", "marca"]);
  const barcode = cleanBarcode(readStringFromKeys(row, ["barcode", "ean", "gtin", "codigo_barras"]));

  const resolvedName = cleanFoodName(productName || name);
  if (!resolvedName) return null;

  const grams = readNumberFromKeys(row, ["grams", "gramos", "estimated_grams", "estimatedGrams", "weight_g", "weight", "ml", "volume_ml", "volumeMl"]);
  const calories = readNumberFromKeys(row, ["calories", "kcal", "energy_kcal", "energia", "cal"]);
  const protein = readNumberFromKeys(row, ["protein", "proteina", "proteins"]);
  const carbs = readNumberFromKeys(row, ["carbs", "carbohydrates", "carbohidratos", "hidratos"]);
  const fat = readNumberFromKeys(row, ["fat", "grasas", "lipidos"]);
  const confidence = readNumberFromKeys(row, ["confidence", "score", "certeza", "confianza"]);
  const isPackaged = readBooleanFromKeys(row, ["is_packaged", "isPackaged", "packaged", "envasado"]) || barcode.length >= 8;

  return {
    name: resolvedName,
    grams: clampNumber(grams, 0, 2000),
    calories: clampNumber(calories, 0, 5000),
    protein: clampNumber(protein, 0, 500),
    carbs: clampNumber(carbs, 0, 500),
    fat: clampNumber(fat, 0, 500),
    confidence: clampNumber(confidence || 60, 0, 100),
    is_packaged: isPackaged,
    brand: cleanFoodName(brand),
    product_name: cleanFoodName(productName),
    barcode,
    nutrition_source: "ai"
  };
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
    const displayName = formatPackagedDisplayName(product, current);
    foods[idx] = {
      ...current,
      name: displayName,
      product_name: displayName,
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

async function enrichFoodsWithNutritionPipeline(
  input: {
    foods: VisionFoodItem[];
    total_calories: number;
    total_protein: number;
    total_carbs: number;
    total_fat: number;
    warning?: string;
    packagedEnriched: number;
  },
  apiKey: string
): Promise<{
  foods: VisionFoodItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  warning?: string;
  packagedEnriched: number;
}> {
  const foods = [...(input.foods ?? [])];
  let estimatedByDb = 0;
  let estimatedByGemini = 0;
  let estimatedHeuristic = 0;
  let geminiLookups = 0;
  const maxGeminiLookups = 2;

  for (let i = 0; i < foods.length; i += 1) {
    const food = foods[i];
    if (!food) continue;
    if (hasMeaningfulNutrition(food)) continue;

    const name = cleanFoodName(food.product_name || food.name);
    const grams = clampNumber(food.grams, 20, 2000);

    if (hasKnownFoodMatch(name)) {
      const n = lookupNutrition(name, grams);
      foods[i] = {
        ...food,
        calories: n.calories,
        protein: n.protein,
        carbs: n.carbs,
        fat: n.fat,
        confidence: Math.max(food.confidence, 78),
        nutrition_source: food.nutrition_source === "product" ? "product" : "db"
      };
      estimatedByDb += 1;
      continue;
    }

    if (geminiLookups < maxGeminiLookups) {
      geminiLookups += 1;
      const estimate = await estimateNutritionWithGemini(apiKey, name, grams);
      if (estimate) {
        foods[i] = {
          ...food,
          calories: estimate.calories,
          protein: estimate.protein,
          carbs: estimate.carbs,
          fat: estimate.fat,
          confidence: Math.max(food.confidence, estimate.confidence),
          nutrition_source: "ai"
        };
        estimatedByGemini += 1;
        continue;
      }
    }

    const fallback = lookupNutrition(name, grams);
    foods[i] = {
      ...food,
      calories: fallback.calories,
      protein: fallback.protein,
      carbs: fallback.carbs,
      fat: fallback.fat,
      confidence: Math.max(45, food.confidence - 10),
      nutrition_source: "db"
    };
    estimatedHeuristic += 1;
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

  const parts: string[] = [];
  if (input.warning) parts.push(input.warning);
  if (estimatedByDb > 0) parts.push(`Nutricion estimada por base local en ${estimatedByDb} alimento(s).`);
  if (estimatedByGemini > 0) parts.push(`Nutricion estimada por IA en ${estimatedByGemini} alimento(s).`);
  if (estimatedHeuristic > 0) parts.push(`Valores aproximados en ${estimatedHeuristic} alimento(s).`);

  return {
    foods,
    total_calories: totals.calories,
    total_protein: totals.protein,
    total_carbs: totals.carbs,
    total_fat: totals.fat,
    warning: parts.length ? parts.join(" ") : undefined,
    packagedEnriched: input.packagedEnriched
  };
}

function packagedLookupQuery(food: VisionFoodItem): { type: "barcode"; value: string } | { type: "text"; value: string } | null {
  const barcode = cleanBarcode(String(food.barcode ?? ""));
  if (barcode.length >= 8) {
    return { type: "barcode", value: barcode };
  }

  const brand = cleanFoodName(String(food.brand ?? ""));
  const productName = cleanFoodName(String(food.product_name ?? ""));
  const name = cleanFoodName(String(food.name ?? ""));

  const hasBrand = brand.length >= 3 && !isGenericFoodWord(brand);
  const brandedHint = looksLikePackagedName(`${brand} ${productName || name}`);
  const hasStrongPackagedSignal = Boolean(food.is_packaged) || hasBrand || brandedHint;

  if (!hasStrongPackagedSignal) return null;

  const text = `${brand} ${productName || name}`.trim();
  if (!text || text.length < 5) return null;
  if (!hasBrand && !brandedHint && tokenizeLookupText(text).length < 2) return null;
  return { type: "text", value: text };
}

function looksLikePackagedName(name: string): boolean {
  const key = cleanFoodName(name).toLowerCase();
  if (!key) return false;
  return (
    key.includes("coca cola") ||
    key.includes("coca-cola") ||
    key.includes("pepsi") ||
    key.includes("kellogg") ||
    key.includes("oreo") ||
    key.includes("nestle") ||
    key.includes("danone") ||
    key.includes("monster") ||
    key.includes("red bull") ||
    key.includes("protein bar") ||
    key.includes("barrita proteica")
  );
}

async function fetchOpenFoodFactsProduct(
  query: { type: "barcode"; value: string } | { type: "text"; value: string }
): Promise<OpenFoodFactsProduct | null> {
  try {
    if (query.type === "barcode") {
      const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(query.value)}.json`;
      const response = await fetchWithTimeout(url, { cache: "no-store" }, OFF_TIMEOUT_MS);
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

    const response = await fetchWithTimeout(searchUrl.toString(), { cache: "no-store" }, OFF_TIMEOUT_MS);
    if (!response.ok) return null;
    const parsed = (await response.json()) as { products?: OpenFoodFactsProduct[] };
    const products = Array.isArray(parsed.products) ? parsed.products : [];
    const ranked = products
      .map((p) => ({
        product: p,
        score: openFoodFactsTextScore(query.value, p),
        nutrition: extractNutritionPer100(p.nutriments)
      }))
      .filter((x) => x.nutrition)
      .filter((x) => !isContradictoryProductForQuery(query.value, x.product, x.nutrition!))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best) return null;
    if (best.score < minOpenFoodFactsScore(query.value)) return null;
    return best.product;
  } catch {
    return null;
  }
}

function openFoodFactsTextScore(queryText: string, product: OpenFoodFactsProduct): number {
  const qTokens = tokenizeLookupText(queryText);
  const label = `${product.brands ?? ""} ${product.product_name_es ?? product.product_name ?? ""}`.trim();
  const pTokens = tokenizeLookupText(label);
  if (!qTokens.length || !pTokens.length) return 0;
  const q = new Set(qTokens);
  const p = new Set(pTokens);
  const inter = [...q].filter((t) => p.has(t)).length;
  const union = new Set([...q, ...p]).size || 1;
  return inter / union;
}

function minOpenFoodFactsScore(queryText: string): number {
  const tokens = tokenizeLookupText(queryText);
  if (tokens.length >= 4) return 0.58;
  if (tokens.length === 3) return 0.64;
  return 0.72;
}

function isContradictoryProductForQuery(
  queryText: string,
  product: OpenFoodFactsProduct,
  nutrition: { calories: number; protein: number; carbs: number; fat: number }
): boolean {
  if (!queryRequiresZeroProfile(queryText)) return false;
  const label = `${product.brands ?? ""} ${product.product_name_es ?? product.product_name ?? ""}`.trim();
  const looksZero = labelLooksZero(label);
  if (looksZero) return false;

  // If user asks for a "zero/light/sugar free" product, discard clearly sugary matches.
  return nutrition.calories > 8 || nutrition.carbs > 2;
}

function queryRequiresZeroProfile(queryText: string): boolean {
  const normalized = cleanFoodName(queryText).toLowerCase();
  return (
    normalized.includes("zero") ||
    normalized.includes("light") ||
    normalized.includes("sin azucar") ||
    normalized.includes("sin azúcar") ||
    normalized.includes("sugar free") ||
    normalized.includes("no sugar")
  );
}

function labelLooksZero(text: string): boolean {
  const normalized = cleanFoodName(text).toLowerCase();
  return (
    normalized.includes("zero") ||
    normalized.includes("light") ||
    normalized.includes("sin azucar") ||
    normalized.includes("sin azúcar") ||
    normalized.includes("sugar free") ||
    normalized.includes("no sugar")
  );
}

function tokenizeLookupText(text: string): string[] {
  return cleanFoodName(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function isGenericFoodWord(text: string): boolean {
  const t = cleanFoodName(text).toLowerCase();
  if (!t) return true;
  const generic = [
    "comida",
    "alimento",
    "food",
    "snack",
    "drink",
    "bebida",
    "yogur",
    "yogurt",
    "cereal",
    "galleta",
    "sopa",
    "ensalada"
  ];
  return generic.some((w) => t === w);
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

function formatPackagedDisplayName(product: OpenFoodFactsProduct, fallback: VisionFoodItem): string {
  const brand = cleanFoodName(product.brands || fallback.brand || "");
  const baseName = cleanFoodName(product.product_name_es || product.product_name || fallback.product_name || fallback.name);
  if (!brand) return baseName || cleanFoodName(fallback.name || "Producto envasado");
  if (!baseName) return brand;
  if (baseName.toLowerCase().includes(brand.toLowerCase())) return baseName;
  return cleanFoodName(`${brand} ${baseName}`);
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
      name: formatOutputFoodName(food),
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

function formatOutputFoodName(food: VisionFoodItem): string {
  const base = cleanFoodName(food.product_name || food.name);
  const brand = cleanFoodName(food.brand || "");
  if (!food.is_packaged || !brand) return base || brand || "Alimento detectado";
  if (base.toLowerCase().includes(brand.toLowerCase())) return base;
  return cleanFoodName(`${brand} ${base}`);
}

function hasMeaningfulNutrition(food: VisionFoodItem): boolean {
  const calories = clampNumber(food.calories, 0, 5000);
  const macros = clampNumber(food.protein, 0, 500) + clampNumber(food.carbs, 0, 500) + clampNumber(food.fat, 0, 500);
  return calories > 0 && (macros > 0 || calories > 10);
}

async function estimateNutritionWithGemini(
  apiKey: string,
  name: string,
  grams: number
): Promise<{ calories: number; protein: number; carbs: number; fat: number; confidence: number } | null> {
  const prompt = [
    "Devuelve SOLO JSON valido sin markdown.",
    "Estima nutricion para este alimento en gramos dados.",
    `name: ${name}`,
    `grams: ${Math.round(grams)}`,
    "Formato:",
    '{"calories":0,"protein":0,"carbs":0,"fat":0,"confidence":0}'
  ].join("\n");

  for (const model of getModelCandidates()) {
    for (const apiVersion of API_VERSIONS) {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 180
        }
      };

      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            cache: "no-store"
          },
          9_000
        );
      } catch {
        continue;
      }

      if (!response.ok) continue;
      const raw = await response.text();
      const envelope = safeJsonParse<GeminiGenerateResponse>(raw);
      if (!envelope) continue;
      const text = collectGeminiText(envelope);
      if (!text) continue;

      const candidate = safeJsonParse<Record<string, unknown>>(extractJsonObject(text) ?? text);
      if (!candidate) continue;

      const calories = clampNumber(readNumberFromKeys(candidate, ["calories", "kcal", "energy_kcal"]), 0, 5000);
      const protein = clampNumber(readNumberFromKeys(candidate, ["protein", "proteina"]), 0, 500);
      const carbs = clampNumber(readNumberFromKeys(candidate, ["carbs", "carbohydrates", "carbohidratos"]), 0, 500);
      const fat = clampNumber(readNumberFromKeys(candidate, ["fat", "grasas"]), 0, 500);
      const confidence = clampNumber(readNumberFromKeys(candidate, ["confidence", "confianza", "score"]), 0, 100);

      if (calories <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) continue;
      return { calories, protein, carbs, fat, confidence: Math.max(55, confidence) };
    }
  }

  return null;
}

function collectGeminiText(envelope: GeminiGenerateResponse): string {
  const parts = envelope.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => String(p.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
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

function normalizeMimeType(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw.startsWith("image/")) return "image/jpeg";
  if (raw.includes("heic") || raw.includes("heif")) return "image/jpeg";
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickArray(source: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function readStringFromKeys(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readNumberFromKeys(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = String(value).replace(",", ".").trim();
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const extracted = Number(match[0]);
      if (Number.isFinite(extracted)) return extracted;
    }
  }
  return 0;
}

function readBooleanFromKeys(source: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      if (["true", "1", "si", "si", "yes"].includes(lower)) return true;
      if (["false", "0", "no"].includes(lower)) return false;
    }
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = GEMINI_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  const now = Date.now();
  const merged = [GEMINI_MODEL, ...MODEL_FALLBACKS]
    .map((model) => model.trim())
    .filter(Boolean);

  const unique = [...new Set(merged)];
  const forced = GEMINI_MODEL.trim();

  const active = unique.filter((model) => {
    const blockedUntil = modelBackoffUntil.get(model) ?? 0;
    return blockedUntil <= now;
  });
  const pool = active.length > 0 ? active : unique;

  const sorted = [...pool].sort((a, b) => modelScore(b) - modelScore(a));
  const forcedAllowed = forced && ((modelBackoffUntil.get(forced) ?? 0) <= now || active.length === 0);
  if (!forcedAllowed) return sorted;
  if (!sorted.includes(forced)) return [forced, ...sorted];
  return [forced, ...sorted.filter((m) => m !== forced)];
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

function modelScore(model: string): number {
  const lower = model.toLowerCase();
  const hint = MODEL_PRIORITY_HINTS.find((x) => lower.includes(x.token));
  const base = hint?.score ?? 600;
  const latestBoost = lower.includes("latest") ? 8 : 0;
  return base + latestBoost;
}

function setModelBackoff(model: string, durationMs: number): void {
  const safeMs = clampNumber(durationMs, 1_000, 24 * 60 * 60 * 1000);
  modelBackoffUntil.set(model, Date.now() + safeMs);
}

function timeoutForModel(model: string): number {
  const lower = model.toLowerCase();
  if (lower.includes("pro")) return 24_000;
  if (lower.includes("lite")) return 12_000;
  return GEMINI_TIMEOUT_MS;
}



