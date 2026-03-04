import Foundation

struct DetectedFood: Codable, Identifiable, Sendable {
    var id: UUID
    var name: String
    var estimatedGrams: Double
    var confidence: Double // 0.0...1.0
    var category: FoodCategory
    var nutrition: NutritionInfo

    init(
        id: UUID = UUID(),
        name: String,
        estimatedGrams: Double,
        confidence: Double,
        category: FoodCategory = .other,
        nutrition: NutritionInfo
    ) {
        self.id = id
        self.name = name
        self.estimatedGrams = max(0, estimatedGrams)
        self.confidence = min(max(confidence, 0), 1)
        self.category = category
        self.nutrition = nutrition
    }
}

enum FoodCategory: String, Codable, Sendable {
    case protein
    case carb
    case vegetable
    case fruit
    case dairy
    case fat
    case beverage
    case other

    var emoji: String {
        switch self {
        case .protein: return "🥩"
        case .carb: return "🍚"
        case .vegetable: return "🥦"
        case .fruit: return "🍎"
        case .dairy: return "🥛"
        case .fat: return "🥑"
        case .beverage: return "🥤"
        case .other: return "🍽"
        }
    }
}
