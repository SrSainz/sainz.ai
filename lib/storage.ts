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
  saveMeals(next);
  return next;
}

export function deleteMeal(id: string): MealLog[] {
  const next = loadMeals().filter((m) => m.id !== id);
  saveMeals(next);
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
