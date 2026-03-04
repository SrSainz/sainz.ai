import Foundation
import SwiftData

@Model
final class MealLog {
    var id: UUID
    var date: Date
    var imageData: Data?
    var foodsJSON: Data
    var totalCalories: Double
    var totalProtein: Double
    var totalCarbs: Double
    var totalFat: Double
    var totalFiber: Double
    var mealName: String

    init(
        date: Date = Date(),
        imageData: Data? = nil,
        foods: [DetectedFood],
        mealName: String = "Meal"
    ) {
        self.id = UUID()
        self.date = date
        self.imageData = imageData
        self.mealName = mealName
        self.foodsJSON = (try? JSONEncoder().encode(foods)) ?? Data()
        self.totalCalories = foods.reduce(0) { $0 + $1.nutrition.calories }
        self.totalProtein = foods.reduce(0) { $0 + $1.nutrition.protein }
        self.totalCarbs = foods.reduce(0) { $0 + $1.nutrition.carbs }
        self.totalFat = foods.reduce(0) { $0 + $1.nutrition.fat }
        self.totalFiber = foods.reduce(0) { $0 + $1.nutrition.fiber }
    }

    var detectedFoods: [DetectedFood] {
        (try? JSONDecoder().decode([DetectedFood].self, from: foodsJSON)) ?? []
    }
}
