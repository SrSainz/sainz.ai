import Foundation

enum NutritionDatabase {
    static let foods: [String: FoodNutrition] = [
        "chicken breast": FoodNutrition(name: "Chicken Breast", caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, category: .protein),
        "salmon": FoodNutrition(name: "Salmon", caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, fiberPer100g: 0, category: .protein),
        "egg": FoodNutrition(name: "Egg", caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11, fiberPer100g: 0, category: .protein),
        "white rice": FoodNutrition(name: "White Rice", caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0.4, category: .carb),
        "pasta": FoodNutrition(name: "Pasta", caloriesPer100g: 131, proteinPer100g: 5, carbsPer100g: 25, fatPer100g: 1.1, fiberPer100g: 1.8, category: .carb),
        "potato": FoodNutrition(name: "Potato", caloriesPer100g: 77, proteinPer100g: 2, carbsPer100g: 17, fatPer100g: 0.1, fiberPer100g: 2.2, category: .carb),
        "broccoli": FoodNutrition(name: "Broccoli", caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 6.6, fatPer100g: 0.4, fiberPer100g: 2.6, category: .vegetable),
        "salad": FoodNutrition(name: "Salad", caloriesPer100g: 15, proteinPer100g: 1.2, carbsPer100g: 2.9, fatPer100g: 0.2, fiberPer100g: 1.8, category: .vegetable),
        "apple": FoodNutrition(name: "Apple", caloriesPer100g: 52, proteinPer100g: 0.3, carbsPer100g: 14, fatPer100g: 0.2, fiberPer100g: 2.4, category: .fruit),
        "banana": FoodNutrition(name: "Banana", caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3, fiberPer100g: 2.6, category: .fruit),
        "yogurt": FoodNutrition(name: "Yogurt", caloriesPer100g: 59, proteinPer100g: 3.5, carbsPer100g: 5, fatPer100g: 3.3, fiberPer100g: 0, category: .dairy),
        "milk": FoodNutrition(name: "Milk", caloriesPer100g: 61, proteinPer100g: 3.2, carbsPer100g: 4.8, fatPer100g: 3.3, fiberPer100g: 0, category: .dairy),
        "avocado": FoodNutrition(name: "Avocado", caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15, fiberPer100g: 7, category: .fat),
        "olive oil": FoodNutrition(name: "Olive Oil", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100, fiberPer100g: 0, category: .fat)
    ]

    static func lookup(name: String, grams: Double) -> NutritionInfo {
        let key = normalize(name)
        if let food = foods[key] {
            return food.scaled(toGrams: grams)
        }

        for (foodKey, food) in foods where key.contains(foodKey) || foodKey.contains(key) {
            return food.scaled(toGrams: grams)
        }

        let estimatedCalories = max(0, grams) * 1.5
        return NutritionInfo(
            calories: estimatedCalories,
            protein: grams * 0.1,
            carbs: grams * 0.15,
            fat: grams * 0.05,
            fiber: grams * 0.02
        )
    }

    static func category(for foodName: String) -> FoodCategory {
        let key = normalize(foodName)
        if let exact = foods[key] {
            return exact.category
        }

        for (foodKey, food) in foods where key.contains(foodKey) || foodKey.contains(key) {
            return food.category
        }
        return .other
    }

    private static func normalize(_ text: String) -> String {
        text.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: " ")
    }
}
