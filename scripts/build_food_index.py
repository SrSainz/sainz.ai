#!/usr/bin/env python3
"""
Build a compact local food index from Open Food Facts dump.

Input:
  data/raw/off/en.openfoodfacts.org.products.csv.gz

Output:
  data/index/off-food-index.v1.json
"""

from __future__ import annotations

import csv
import gzip
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

csv.field_size_limit(10_000_000)


ROOT = Path(__file__).resolve().parents[1]
INPUT_OFF = ROOT / "data" / "raw" / "off" / "en.openfoodfacts.org.products.csv.gz"
OUTPUT_DIR = ROOT / "data" / "index"
OUTPUT_FILE = OUTPUT_DIR / "off-food-index.v1.json"


ZERO_WORDS = (
    "zero",
    "light",
    "sin azucar",
    "sin azúcar",
    "sugar free",
    "no sugar",
)

KNOWN_GLOBAL_BRANDS = (
    "coca",
    "pepsi",
    "monster",
    "red bull",
    "nestle",
    "danone",
    "kellogg",
    "oreo",
    "actimel",
    "aquarius",
    "fanta",
    "sprite",
)


def normalize_text(text: str) -> str:
    value = unicodedata.normalize("NFD", text.lower().strip())
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^a-z0-9\s]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_float(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", ".")
    if not text:
        return None
    try:
        value = float(text)
        if value != value:
            return None
        return value
    except Exception:
        return None


def parse_barcode(raw: Optional[str]) -> str:
    if raw is None:
        return ""
    digits = re.sub(r"\D+", "", str(raw))
    if len(digits) < 8:
        return ""
    return digits[:20]


def first_brand(raw: Optional[str]) -> str:
    if raw is None:
        return ""
    text = str(raw).strip()
    if not text:
        return ""
    value = text.split(",")[0].strip()
    return value[:80]


def has_zero_hint(text: str) -> bool:
    lower = normalize_text(text)
    return any(word in lower for word in ZERO_WORDS)


def looks_global_brand(brand: str, name: str) -> bool:
    joined = normalize_text(f"{brand} {name}")
    return any(token in joined for token in KNOWN_GLOBAL_BRANDS)


def combine_brand_name(brand: str, name: str) -> str:
    clean_brand = brand.strip()
    clean_name = name.strip()
    if not clean_brand:
        return clean_name
    if not clean_name:
        return clean_brand
    lower_brand = normalize_text(clean_brand)
    lower_name = normalize_text(clean_name)
    if lower_brand and lower_brand in lower_name:
        return clean_name
    return f"{clean_brand} {clean_name}".strip()


@dataclass
class Entry:
    barcode: str
    name: str
    brand: str
    quantity: str
    kcal100: float
    protein100: float
    carbs100: float
    fat100: float
    source: str
    score: int


def choose_better(a: Entry, b: Entry) -> Entry:
    if b.score > a.score:
        return b
    if b.score == a.score and len(b.name) > len(a.name):
        return b
    return a


def main() -> None:
    if not INPUT_OFF.exists():
        raise SystemExit(f"Missing input file: {INPUT_OFF}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    barcodes: Dict[str, Entry] = {}
    names: Dict[str, str] = {}

    processed = 0
    kept = 0

    with gzip.open(INPUT_OFF, "rt", encoding="utf-8", newline="", errors="replace") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            processed += 1

            barcode = parse_barcode(row.get("code"))
            if not barcode:
                continue

            product_name = (row.get("product_name_es") or row.get("product_name") or "").strip()
            brand = first_brand(row.get("brands"))
            quantity = (row.get("quantity") or "").strip()[:60]
            if not product_name:
                continue

            kcal = parse_float(row.get("energy-kcal_100g")) or parse_float(row.get("energy_kcal_100g"))
            protein = parse_float(row.get("proteins_100g"))
            carbs = parse_float(row.get("carbohydrates_100g"))
            fat = parse_float(row.get("fat_100g"))

            if kcal is None or protein is None or carbs is None or fat is None:
                continue

            countries = (row.get("countries_tags") or "").lower()
            is_spain = "spain" in countries or "en:spain" in countries or "es:spain" in countries
            zero_hint = has_zero_hint(f"{brand} {product_name}")
            keep_row = is_spain or zero_hint or looks_global_brand(brand, product_name)
            if not keep_row:
                continue

            score = 0
            if is_spain:
                score += 5
            if brand:
                score += 2
            if quantity:
                score += 1
            if zero_hint:
                score += 2
            score += min(4, len(normalize_text(product_name).split()))

            display_name = combine_brand_name(brand, product_name)[:120]
            entry = Entry(
                barcode=barcode,
                name=display_name,
                brand=brand[:80],
                quantity=quantity,
                kcal100=max(0.0, min(900.0, kcal)),
                protein100=max(0.0, min(100.0, protein)),
                carbs100=max(0.0, min(100.0, carbs)),
                fat100=max(0.0, min(100.0, fat)),
                source="off",
                score=score,
            )

            if barcode in barcodes:
                barcodes[barcode] = choose_better(barcodes[barcode], entry)
            else:
                barcodes[barcode] = entry
                kept += 1

            for key in {normalize_text(product_name), normalize_text(display_name)}:
                if len(key) < 4:
                    continue
                existing = names.get(key)
                if not existing:
                    names[key] = barcode
                    continue
                if existing == barcode:
                    continue
                current = barcodes.get(existing)
                if current and entry.score > current.score:
                    names[key] = barcode

            if processed % 300000 == 0:
                print(f"Processed {processed:,} rows | barcodes: {len(barcodes):,} | names: {len(names):,}")

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file": str(INPUT_OFF),
        "stats": {
            "processed_rows": processed,
            "kept_barcodes": len(barcodes),
            "kept_names": len(names),
            "new_barcodes": kept,
        },
        "barcodes": {
            code: {
                "name": row.name,
                "brand": row.brand,
                "quantity": row.quantity,
                "kcal100": round(row.kcal100, 3),
                "protein100": round(row.protein100, 3),
                "carbs100": round(row.carbs100, 3),
                "fat100": round(row.fat100, 3),
                "source": row.source,
            }
            for code, row in barcodes.items()
        },
        "names": names,
    }

    with OUTPUT_FILE.open("w", encoding="utf-8") as out:
        json.dump(payload, out, ensure_ascii=False, separators=(",", ":"))

    size_mb = OUTPUT_FILE.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUTPUT_FILE} ({size_mb:.1f} MB)")
    print(json.dumps(payload["stats"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
