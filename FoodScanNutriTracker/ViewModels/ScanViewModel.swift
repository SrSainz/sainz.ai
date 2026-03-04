import Foundation
import Observation
import SwiftData
import SwiftUI
import UIKit

@Observable
final class ScanViewModel {
    var selectedImage: UIImage? = nil
    var detectedFoods: [DetectedFood] = []
    var isAnalyzing: Bool = false
    var errorMessage: String? = nil
    var showResult: Bool = false
    var mealName: String = "Meal"

    var totalNutrition: NutritionInfo {
        detectedFoods.reduce(.zero) { $0 + $1.nutrition }
    }

    @MainActor
    func analyze(image: UIImage) async {
        selectedImage = image
        isAnalyzing = true
        errorMessage = nil
        detectedFoods = []

        defer { isAnalyzing = false }

        do {
            let result = try await GeminiVisionService.shared.analyze(image: image, maxRetries: 2)
            detectedFoods = result.foods
            showResult = !result.foods.isEmpty
            if result.foods.isEmpty {
                errorMessage = GeminiVisionError.noFoodsDetected.localizedDescription
            }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func updateGrams(for id: UUID, grams: Double) {
        guard let index = detectedFoods.firstIndex(where: { $0.id == id }) else { return }
        guard grams > 0 else { return }

        let food = detectedFoods[index]
        let factor = grams / max(food.estimatedGrams, 1)
        let newNutrition = NutritionInfo(
            calories: food.nutrition.calories * factor,
            protein: food.nutrition.protein * factor,
            carbs: food.nutrition.carbs * factor,
            fat: food.nutrition.fat * factor,
            fiber: food.nutrition.fiber * factor
        )

        detectedFoods[index] = DetectedFood(
            id: food.id,
            name: food.name,
            estimatedGrams: grams,
            confidence: food.confidence,
            category: food.category,
            nutrition: newNutrition
        )
    }

    func removeFood(at offsets: IndexSet) {
        detectedFoods.remove(atOffsets: offsets)
    }

    func save(context: ModelContext) {
        guard !detectedFoods.isEmpty else { return }

        let compressed = selectedImage.flatMap { img -> Data? in
            let maxD: CGFloat = 1000
            let scale = min(maxD / img.size.width, maxD / img.size.height, 1.0)
            let newSize = CGSize(width: img.size.width * scale, height: img.size.height * scale)
            let renderer = UIGraphicsImageRenderer(size: newSize)
            let resized = renderer.image { _ in img.draw(in: CGRect(origin: .zero, size: newSize)) }
            return resized.jpegData(compressionQuality: 0.65)
        }

        let log = MealLog(
            date: Date(),
            imageData: compressed,
            foods: detectedFoods,
            mealName: mealName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Meal" : mealName
        )
        context.insert(log)
        reset()
    }

    func reset() {
        selectedImage = nil
        detectedFoods = []
        isAnalyzing = false
        errorMessage = nil
        showResult = false
        mealName = "Meal"
    }
}
