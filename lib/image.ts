export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

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

function approximateBase64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
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
