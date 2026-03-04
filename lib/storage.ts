import { MealLog } from "./types";

const MEALS_KEY = "sainzcal_meals_v1";

export function loadMeals(): MealLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MealLog[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch {
    return [];
  }
}

export function saveMeals(meals: MealLog[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MEALS_KEY, JSON.stringify(meals));
}

export function addMeal(meal: MealLog): MealLog[] {
  const current = loadMeals();
  const next = [meal, ...current];

  if (trySaveMeals(next)) {
    return next;
  }

  // If storage quota is exceeded, progressively drop images from older meals.
  const withoutOldImages = next.map((m, idx) => (idx === 0 ? m : { ...m, imageDataUrl: undefined }));
  if (trySaveMeals(withoutOldImages)) {
    return withoutOldImages;
  }

  // Last fallback: keep newest meals only.
  const trimmed = [...withoutOldImages];
  while (trimmed.length > 1) {
    trimmed.pop();
    if (trySaveMeals(trimmed)) {
      return trimmed;
    }
  }

  throw new Error("No se pudo guardar. El almacenamiento del navegador esta lleno.");
}

export function deleteMeal(id: string): MealLog[] {
  const next = loadMeals().filter((m) => m.id !== id);
  trySaveMeals(next);
  return next;
}

export function isToday(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function isYesterday(isoDate: string): boolean {
  const d = new Date(isoDate);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  );
}

function trySaveMeals(meals: MealLog[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(MEALS_KEY, JSON.stringify(meals));
    return true;
  } catch {
    return false;
  }
}
