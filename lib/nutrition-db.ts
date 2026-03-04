import { FoodCategory, NutritionInfo } from "./types";

type FoodNutrition = {
  name: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  category: FoodCategory;
};

const foods: Record<string, FoodNutrition> = {
  "chicken breast": { name: "Chicken Breast", caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, category: "protein" },
  "grilled chicken": { name: "Grilled Chicken", caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, category: "protein" },
  salmon: { name: "Salmon", caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, fiberPer100g: 0, category: "protein" },
  tuna: { name: "Tuna", caloriesPer100g: 144, proteinPer100g: 23, carbsPer100g: 0, fatPer100g: 5, fiberPer100g: 0, category: "protein" },
  egg: { name: "Egg", caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11, fiberPer100g: 0, category: "protein" },
  "white rice": { name: "White Rice", caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0.4, category: "carb" },
  "brown rice": { name: "Brown Rice", caloriesPer100g: 112, proteinPer100g: 2.6, carbsPer100g: 24, fatPer100g: 0.8, fiberPer100g: 1.8, category: "carb" },
  rice: { name: "Rice", caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0.4, category: "carb" },
  pasta: { name: "Pasta", caloriesPer100g: 131, proteinPer100g: 5, carbsPer100g: 25, fatPer100g: 1.1, fiberPer100g: 1.8, category: "carb" },
  spaghetti: { name: "Spaghetti", caloriesPer100g: 131, proteinPer100g: 5, carbsPer100g: 25, fatPer100g: 1.1, fiberPer100g: 1.8, category: "carb" },
  bread: { name: "Bread", caloriesPer100g: 265, proteinPer100g: 9, carbsPer100g: 49, fatPer100g: 3.2, fiberPer100g: 2.7, category: "carb" },
  potato: { name: "Potato", caloriesPer100g: 77, proteinPer100g: 2, carbsPer100g: 17, fatPer100g: 0.1, fiberPer100g: 2.2, category: "carb" },
  "sweet potato": { name: "Sweet Potato", caloriesPer100g: 86, proteinPer100g: 1.6, carbsPer100g: 20, fatPer100g: 0.1, fiberPer100g: 3, category: "carb" },
  oatmeal: { name: "Oatmeal", caloriesPer100g: 68, proteinPer100g: 2.4, carbsPer100g: 12, fatPer100g: 1.4, fiberPer100g: 1.7, category: "carb" },
  oats: { name: "Oats", caloriesPer100g: 389, proteinPer100g: 17, carbsPer100g: 66, fatPer100g: 7, fiberPer100g: 10.6, category: "carb" },
  pizza: { name: "Pizza", caloriesPer100g: 266, proteinPer100g: 11, carbsPer100g: 33, fatPer100g: 10, fiberPer100g: 2.3, category: "carb" },
  burger: { name: "Burger", caloriesPer100g: 295, proteinPer100g: 17, carbsPer100g: 24, fatPer100g: 14, fiberPer100g: 0.9, category: "carb" },
  sandwich: { name: "Sandwich", caloriesPer100g: 225, proteinPer100g: 10, carbsPer100g: 30, fatPer100g: 7, fiberPer100g: 2, category: "carb" },
  taco: { name: "Taco", caloriesPer100g: 218, proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 11, fiberPer100g: 1.9, category: "carb" },
  broccoli: { name: "Broccoli", caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 6.6, fatPer100g: 0.4, fiberPer100g: 2.6, category: "vegetable" },
  spinach: { name: "Spinach", caloriesPer100g: 23, proteinPer100g: 2.9, carbsPer100g: 3.6, fatPer100g: 0.4, fiberPer100g: 2.2, category: "vegetable" },
  lettuce: { name: "Lettuce", caloriesPer100g: 15, proteinPer100g: 1.4, carbsPer100g: 2.9, fatPer100g: 0.2, fiberPer100g: 1.3, category: "vegetable" },
  tomato: { name: "Tomato", caloriesPer100g: 18, proteinPer100g: 0.9, carbsPer100g: 3.9, fatPer100g: 0.2, fiberPer100g: 1.2, category: "vegetable" },
  cucumber: { name: "Cucumber", caloriesPer100g: 15, proteinPer100g: 0.7, carbsPer100g: 3.6, fatPer100g: 0.1, fiberPer100g: 0.5, category: "vegetable" },
  carrot: { name: "Carrot", caloriesPer100g: 41, proteinPer100g: 0.9, carbsPer100g: 10, fatPer100g: 0.2, fiberPer100g: 2.8, category: "vegetable" },
  avocado: { name: "Avocado", caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15, fiberPer100g: 7, category: "fat" },
  apple: { name: "Apple", caloriesPer100g: 52, proteinPer100g: 0.3, carbsPer100g: 14, fatPer100g: 0.2, fiberPer100g: 2.4, category: "fruit" },
  banana: { name: "Banana", caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3, fiberPer100g: 2.6, category: "fruit" },
  orange: { name: "Orange", caloriesPer100g: 47, proteinPer100g: 0.9, carbsPer100g: 12, fatPer100g: 0.1, fiberPer100g: 2.4, category: "fruit" },
  strawberry: { name: "Strawberry", caloriesPer100g: 32, proteinPer100g: 0.7, carbsPer100g: 7.7, fatPer100g: 0.3, fiberPer100g: 2, category: "fruit" },
  blueberry: { name: "Blueberry", caloriesPer100g: 57, proteinPer100g: 0.7, carbsPer100g: 14, fatPer100g: 0.3, fiberPer100g: 2.4, category: "fruit" },
  milk: { name: "Milk", caloriesPer100g: 61, proteinPer100g: 3.2, carbsPer100g: 4.8, fatPer100g: 3.3, fiberPer100g: 0, category: "dairy" },
  yogurt: { name: "Yogurt", caloriesPer100g: 59, proteinPer100g: 3.5, carbsPer100g: 5, fatPer100g: 3.3, fiberPer100g: 0, category: "dairy" },
  cheese: { name: "Cheese", caloriesPer100g: 402, proteinPer100g: 25, carbsPer100g: 1.3, fatPer100g: 33, fiberPer100g: 0, category: "dairy" },
  butter: { name: "Butter", caloriesPer100g: 717, proteinPer100g: 0.9, carbsPer100g: 0.1, fatPer100g: 81, fiberPer100g: 0, category: "fat" },
  "olive oil": { name: "Olive Oil", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100, fiberPer100g: 0, category: "fat" },
  almonds: { name: "Almonds", caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50, fiberPer100g: 12.5, category: "fat" },
  "peanut butter": { name: "Peanut Butter", caloriesPer100g: 588, proteinPer100g: 25, carbsPer100g: 20, fatPer100g: 50, fiberPer100g: 6, category: "fat" },
  chocolate: { name: "Chocolate", caloriesPer100g: 546, proteinPer100g: 4.9, carbsPer100g: 60, fatPer100g: 31, fiberPer100g: 7, category: "other" },
  "ice cream": { name: "Ice Cream", caloriesPer100g: 207, proteinPer100g: 3.5, carbsPer100g: 24, fatPer100g: 11, fiberPer100g: 0.7, category: "other" },
  cake: { name: "Cake", caloriesPer100g: 347, proteinPer100g: 5, carbsPer100g: 53, fatPer100g: 13, fiberPer100g: 0.9, category: "other" },
  soup: { name: "Soup", caloriesPer100g: 56, proteinPer100g: 3.1, carbsPer100g: 7.4, fatPer100g: 1.6, fiberPer100g: 0.8, category: "other" },
  sushi: { name: "Sushi", caloriesPer100g: 143, proteinPer100g: 5.1, carbsPer100g: 27, fatPer100g: 0.7, fiberPer100g: 0.3, category: "carb" },
  ramen: { name: "Ramen", caloriesPer100g: 112, proteinPer100g: 4.4, carbsPer100g: 16, fatPer100g: 3.1, fiberPer100g: 0.6, category: "carb" },
  tofu: { name: "Tofu", caloriesPer100g: 76, proteinPer100g: 8, carbsPer100g: 1.9, fatPer100g: 4.8, fiberPer100g: 0.3, category: "protein" },
  beans: { name: "Beans", caloriesPer100g: 127, proteinPer100g: 8.7, carbsPer100g: 23, fatPer100g: 0.5, fiberPer100g: 6.4, category: "protein" },
  lentils: { name: "Lentils", caloriesPer100g: 116, proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 0.4, fiberPer100g: 7.9, category: "protein" },
  coffee: { name: "Coffee", caloriesPer100g: 2, proteinPer100g: 0.3, carbsPer100g: 0, fatPer100g: 0, fiberPer100g: 0, category: "beverage" },
  cola: { name: "Cola", caloriesPer100g: 41, proteinPer100g: 0, carbsPer100g: 11, fatPer100g: 0, fiberPer100g: 0, category: "beverage" }
};

export function lookupNutrition(name: string, grams: number): NutritionInfo {
  const safeGrams = Math.max(0, grams);
  const key = normalize(name);
  const exact = foods[key];
  if (exact) return scaleNutrition(exact, safeGrams);

  for (const [foodKey, food] of Object.entries(foods)) {
    if (key.includes(foodKey) || foodKey.includes(key)) {
      return scaleNutrition(food, safeGrams);
    }
  }

  return {
    calories: safeGrams * 1.5,
    protein: safeGrams * 0.1,
    carbs: safeGrams * 0.15,
    fat: safeGrams * 0.05,
    fiber: safeGrams * 0.02
  };
}

export function categoryForFood(name: string): FoodCategory {
  const key = normalize(name);
  if (foods[key]) return foods[key].category;

  for (const [foodKey, food] of Object.entries(foods)) {
    if (key.includes(foodKey) || foodKey.includes(key)) {
      return food.category;
    }
  }
  return "other";
}

export function categoryEmoji(category: FoodCategory): string {
  switch (category) {
    case "protein":
      return "🥩";
    case "carb":
      return "🍚";
    case "vegetable":
      return "🥦";
    case "fruit":
      return "🍎";
    case "dairy":
      return "🥛";
    case "fat":
      return "🥑";
    case "beverage":
      return "🥤";
    default:
      return "🍽";
  }
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/-/g, " ");
}

function scaleNutrition(food: FoodNutrition, grams: number): NutritionInfo {
  const factor = grams / 100;
  return {
    calories: food.caloriesPer100g * factor,
    protein: food.proteinPer100g * factor,
    carbs: food.carbsPer100g * factor,
    fat: food.fatPer100g * factor,
    fiber: food.fiberPer100g * factor
  };
}
