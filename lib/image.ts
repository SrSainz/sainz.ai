export async function compressImageToBase64(
  file: File,
  maxDimension = 1280,
  maxBytes = 1_500_000
): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(maxDimension / img.width, maxDimension / img.height, 1);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create image context.");
  ctx.drawImage(img, 0, 0, width, height);

  const qualities = [0.85, 0.75, 0.65, 0.55, 0.45];
  let best = "";
  for (const q of qualities) {
    const dataUrl = canvas.toDataURL("image/jpeg", q);
    const base64 = dataUrl.split(",")[1] ?? "";
    if (!base64) continue;
    best = base64;
    const bytes = approximateBase64Bytes(base64);
    if (bytes <= maxBytes) {
      return base64;
    }
  }

  if (!best) throw new Error("Failed to encode image.");
  return best;
}

export async function assessImageQuality(file: File): Promise<{
  ok: boolean;
  score: number;
  warnings: string[];
}> {
  const img = await loadImage(file);
  const target = 192;
  const scale = Math.min(target / img.width, target / img.height, 1);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ok: true, score: 70, warnings: [] };
  }

  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  const luminances: number[] = [];
  luminances.length = width * height;
  let sum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminances[p] = y;
    sum += y;
  }

  const mean = sum / Math.max(luminances.length, 1);
  let variance = 0;
  for (const y of luminances) {
    const d = y - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / Math.max(luminances.length, 1));
  const sharpness = laplacianVariance(luminances, width, height);

  const warnings: string[] = [];
  let penalty = 0;

  if (Math.min(width, height) < 220) {
    warnings.push("La imagen tiene poca resolucion.");
    penalty += 12;
  }
  if (mean < 55) {
    warnings.push("La foto esta oscura.");
    penalty += 22;
  }
  if (mean > 220) {
    warnings.push("La foto esta sobreexpuesta.");
    penalty += 16;
  }
  if (std < 24) {
    warnings.push("Hay poco contraste entre alimento y fondo.");
    penalty += 16;
  }
  if (sharpness < 80) {
    warnings.push("La imagen puede estar borrosa o sin enfoque.");
    penalty += 22;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const ok = score >= 45;
  return { ok, score, warnings };
}

export async function detectBarcodeFromFile(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const win = window as unknown as {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmap | HTMLImageElement | HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>>;
    };
  };

  if (!win.BarcodeDetector) return null;

  try {
    const detector = new win.BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
    });

    const bitmap = await createImageBitmap(file);
    const results = await detector.detect(bitmap);
    bitmap.close?.();

    for (const row of results) {
      const digits = String(row.rawValue ?? "").replace(/\D/g, "");
      if (digits.length >= 8) return digits;
    }
  } catch {
    return null;
  }

  return null;
}

function approximateBase64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function laplacianVariance(gray: number[], width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const c = gray[y * width + x];
      const up = gray[(y - 1) * width + x];
      const down = gray[(y + 1) * width + x];
      const left = gray[y * width + (x - 1)];
      const right = gray[y * width + (x + 1)];
      const lap = up + down + left + right - 4 * c;
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Invalid image"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
