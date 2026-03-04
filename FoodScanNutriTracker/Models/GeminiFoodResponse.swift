import Foundation

struct GeminiFoodResponse: Codable, Sendable {
    var foods: [GeminiFoodItem]
    var totalCalories: Double
    var totalProtein: Double
    var totalCarbs: Double
    var totalFat: Double

    enum CodingKeys: String, CodingKey {
        case foods
        case totalCalories = "total_calories"
        case totalProtein = "total_protein"
        case totalCarbs = "total_carbs"
        case totalFat = "total_fat"
    }
}

struct GeminiFoodItem: Codable, Sendable {
    var name: String
    var grams: Double
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var confidence: Double // 0...100
}

extension GeminiFoodItem {
    func validated() -> GeminiFoodItem? {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        guard [grams, calories, protein, carbs, fat, confidence].allSatisfy({ $0.isFinite }) else { return nil }

        return GeminiFoodItem(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            grams: max(0, grams),
            calories: max(0, calories),
            protein: max(0, protein),
            carbs: max(0, carbs),
            fat: max(0, fat),
            confidence: min(max(confidence, 0), 100)
        )
    }
}
