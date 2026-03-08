import fs from "node:fs";
import path from "node:path";

type LocalIndexEntry = {
  name: string;
  brand: string;
  quantity: string;
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  source: string;
};

type LocalFoodIndexPayload = {
  version: number;
  barcodes: Record<string, LocalIndexEntry>;
  names: Record<string, string>;
};

export type LocalFoodProduct = {
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  calories100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  source: string;
};

let cachedPayload: LocalFoodIndexPayload | null | undefined;

export function lookupLocalProductByBarcode(barcodeRaw: string): LocalFoodProduct | null {
  const payload = loadLocalFoodIndex();
  if (!payload) return null;
  const barcode = cleanBarcode(barcodeRaw);
  if (barcode.length < 8) return null;

  const entry = payload.barcodes[barcode];
  if (!entry) return null;
  return mapEntry(barcode, entry);
}

export function lookupLocalProductByText(queryRaw: string): LocalFoodProduct | null {
  const payload = loadLocalFoodIndex();
  if (!payload) return null;
  const query = normalizeKey(queryRaw);
  if (!query || query.length < 4) return null;

  const exactBarcode = payload.names[query];
  if (exactBarcode) {
    const exact = payload.barcodes[exactBarcode];
    if (exact) return mapEntry(exactBarcode, exact);
  }

  // Prefix fallback for slightly noisy OCR outputs.
  const candidates = Object.entries(payload.names)
    .filter(([key]) => key.startsWith(query) || query.startsWith(key))
    .slice(0, 24);

  let best: { barcode: string; score: number } | null = null;
  for (const [key, barcode] of candidates) {
    const score = similarityScore(query, key);
    if (!best || score > best.score) best = { barcode, score };
  }

  if (!best || best.score < 0.58) return null;
  const entry = payload.barcodes[best.barcode];
  if (!entry) return null;
  return mapEntry(best.barcode, entry);
}

function mapEntry(barcode: string, entry: LocalIndexEntry): LocalFoodProduct {
  return {
    barcode,
    name: entry.name,
    brand: entry.brand,
    quantity: entry.quantity,
    calories100: clampNum(entry.kcal100, 0, 900),
    protein100: clampNum(entry.protein100, 0, 100),
    carbs100: clampNum(entry.carbs100, 0, 100),
    fat100: clampNum(entry.fat100, 0, 100),
    source: entry.source || "local"
  };
}

function loadLocalFoodIndex(): LocalFoodIndexPayload | null {
  if (cachedPayload !== undefined) return cachedPayload;

  const filePath = path.join(process.cwd(), "data", "index", "off-food-index.v1.json");
  try {
    if (!fs.existsSync(filePath)) {
      cachedPayload = null;
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as LocalFoodIndexPayload;
    const valid = parsed && typeof parsed === "object" && parsed.barcodes && parsed.names;
    cachedPayload = valid ? parsed : null;
  } catch {
    cachedPayload = null;
  }
  return cachedPayload;
}

function cleanBarcode(value: string): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 20);
}

function normalizeKey(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampNum(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function similarityScore(a: string, b: string): number {
  if (a === b) return 1;
  const aTokens = new Set(a.split(" ").filter((x) => x.length >= 2));
  const bTokens = new Set(b.split(" ").filter((x) => x.length >= 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let inter = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) inter += 1;
  }
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  return inter / union;
}
