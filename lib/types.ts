export type FoodCategory =
  | "protein"
  | "carb"
  | "vegetable"
  | "fruit"
  | "dairy"
  | "fat"
  | "beverage"
  | "other";

export type NutritionInfo = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

export type DetectedFood = {
  id: string;
  name: string;
  estimatedGrams: number;
  confidence: number; // 0...1
  category: FoodCategory;
  nutrition: NutritionInfo;
};

export type MealLog = {
  id: string;
  date: string;
  imageDataUrl?: string;
  foods: DetectedFood[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalFiber: number;
  mealName: string;
};

export type GeminiFoodItem = {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number; // 0...100
};

export type GeminiFoodResponse = {
  foods: GeminiFoodItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
};
