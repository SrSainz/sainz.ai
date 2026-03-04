import Foundation

struct NutritionInfo: Codable, Sendable {
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var fiber: Double

    static let zero = NutritionInfo(calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0)

    static func + (lhs: NutritionInfo, rhs: NutritionInfo) -> NutritionInfo {
        NutritionInfo(
            calories: lhs.calories + rhs.calories,
            protein: lhs.protein + rhs.protein,
            carbs: lhs.carbs + rhs.carbs,
            fat: lhs.fat + rhs.fat,
            fiber: lhs.fiber + rhs.fiber
        )
    }
}

struct FoodNutrition: Sendable {
    let name: String
    let caloriesPer100g: Double
    let proteinPer100g: Double
    let carbsPer100g: Double
    let fatPer100g: Double
    let fiberPer100g: Double
    let category: FoodCategory

    func scaled(toGrams grams: Double) -> NutritionInfo {
        let factor = max(grams, 0) / 100.0
        return NutritionInfo(
            calories: caloriesPer100g * factor,
            protein: proteinPer100g * factor,
            carbs: carbsPer100g * factor,
            fat: fatPer100g * factor,
            fiber: fiberPer100g * factor
        )
    }
}
