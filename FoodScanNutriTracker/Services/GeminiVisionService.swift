import Foundation
import UIKit

struct GeminiAnalysisResult: Sendable {
    let foods: [DetectedFood]
    let totals: NutritionInfo
}

enum GeminiVisionError: Error, LocalizedError, Sendable {
    case noAPIKey
    case imageEncodingFailed
    case requestEncodingFailed
    case networkError(String)
    case invalidResponse
    case invalidJSON
    case noFoodsDetected
    case apiError(String)

    var errorDescription: String? {
        switch self {
        case .noAPIKey:
            return "Gemini API key not configured."
        case .imageEncodingFailed:
            return "Failed to encode image."
        case .requestEncodingFailed:
            return "Failed to encode Gemini request."
        case .networkError(let msg):
            return "Network error: \(msg)"
        case .invalidResponse:
            return "Gemini returned an invalid response."
        case .invalidJSON:
            return "Gemini did not return valid JSON."
        case .noFoodsDetected:
            return "No foods detected in image."
        case .apiError(let msg):
            return msg
        }
    }
}

final class GeminiVisionService: @unchecked Sendable {
    static let shared = GeminiVisionService()
    private init() {}

    private let endpoint = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent"
    private let imageMimeType = "image/jpeg"
    private let maxImageBytes = 1_500_000
    private let maxImageDimension: CGFloat = 1280

    private let prompt = """
    Analyze this food image.

    Identify all visible food items.

    For each food item:
    - name
    - estimated weight in grams
    - estimated calories
    - protein (g)
    - carbs (g)
    - fat (g)
    - confidence (0-100%)

    Return ONLY valid JSON in this format:

    {
      "foods": [
        {
          "name": "",
          "grams": 0,
          "calories": 0,
          "protein": 0,
          "carbs": 0,
          "fat": 0,
          "confidence": 0
        }
      ],
      "total_calories": 0,
      "total_protein": 0,
      "total_carbs": 0,
      "total_fat": 0
    }

    Do not add explanations.
    Be realistic with portion sizes.
    """

    func analyze(image: UIImage, maxRetries: Int = 2) async throws -> GeminiAnalysisResult {
        guard let apiKey = resolvedAPIKey() else {
            throw GeminiVisionError.noAPIKey
        }
        guard let imageData = prepareImageData(image) else {
            throw GeminiVisionError.imageEncodingFailed
        }

        var lastError: Error = GeminiVisionError.invalidResponse
        for attempt in 0...maxRetries {
            do {
                let responseText = try await requestGemini(
                    apiKey: apiKey,
                    imageBase64: imageData.base64EncodedString()
                )

                let decoded = try decodeGeminiFoodJSON(from: responseText)
                let foods = mapToDetectedFoods(decoded.foods)
                guard !foods.isEmpty else {
                    throw GeminiVisionError.noFoodsDetected
                }

                let totals = NutritionInfo(
                    calories: decoded.totalCalories,
                    protein: decoded.totalProtein,
                    carbs: decoded.totalCarbs,
                    fat: decoded.totalFat,
                    fiber: foods.reduce(0) { $0 + $1.nutrition.fiber }
                )
                return GeminiAnalysisResult(foods: foods, totals: totals)
            } catch {
                lastError = error
                let shouldRetry = attempt < maxRetries && isRetryable(error)
                if shouldRetry {
                    continue
                }
            }
        }

        if let geminiError = lastError as? GeminiVisionError, case .invalidJSON = geminiError {
            return safeFallbackResult()
        }

        if let geminiError = lastError as? GeminiVisionError {
            throw geminiError
        }
        throw GeminiVisionError.networkError(lastError.localizedDescription)
    }

    private func resolvedAPIKey() -> String? {
        let defaultsKey = Config.GEMINI_API_KEY_USER_DEFAULTS_KEY
        let fromDefaults = UserDefaults.standard.string(forKey: defaultsKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let fromDefaults, !fromDefaults.isEmpty {
            return fromDefaults
        }

        let fromConfig = Config.GEMINI_API_KEY.trimmingCharacters(in: .whitespacesAndNewlines)
        return fromConfig.isEmpty ? nil : fromConfig
    }

    private func requestGemini(apiKey: String, imageBase64: String) async throws -> String {
        guard let url = URL(string: "\(endpoint)?key=\(apiKey)") else {
            throw GeminiVisionError.invalidResponse
        }

        let payload = GeminiRequestPayload(
            contents: [
                .init(parts: [
                    .text(prompt),
                    .inlineData(.init(mimeType: imageMimeType, data: imageBase64))
                ])
            ]
        )

        let bodyData: Data
        do {
            bodyData = try JSONEncoder().encode(payload)
        } catch {
            throw GeminiVisionError.requestEncodingFailed
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData
        request.timeoutInterval = 45

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw GeminiVisionError.networkError(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw GeminiVisionError.invalidResponse
        }

        if !(200...299).contains(http.statusCode) {
            if let apiError = try? JSONDecoder().decode(GeminiAPIErrorEnvelope.self, from: data),
               let message = apiError.error.message {
                throw GeminiVisionError.apiError(message)
            }
            throw GeminiVisionError.apiError("Gemini API error (HTTP \(http.statusCode)).")
        }

        guard let decoded = try? JSONDecoder().decode(GeminiGenerateResponse.self, from: data),
              let text = decoded.candidates?.first?.content.parts.first(where: { $0.text != nil })?.text,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw GeminiVisionError.invalidResponse
        }
        return text
    }

    private func decodeGeminiFoodJSON(from rawText: String) throws -> GeminiFoodResponse {
        let cleaned = rawText
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let candidates = [rawText, cleaned, extractJSONObject(from: cleaned)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }

        var lastError: Error = GeminiVisionError.invalidJSON
        for candidate in candidates {
            do {
                let data = Data(candidate.utf8)
                let decoded = try JSONDecoder().decode(GeminiFoodResponse.self, from: data)
                return validated(response: decoded)
            } catch {
                lastError = error
            }
        }

        if lastError is DecodingError {
            throw GeminiVisionError.invalidJSON
        }
        throw GeminiVisionError.invalidJSON
    }

    private func validated(response: GeminiFoodResponse) -> GeminiFoodResponse {
        let foods = response.foods.compactMap { $0.validated() }
        let safeFoods = foods.filter { $0.calories > 0 || $0.protein > 0 || $0.carbs > 0 || $0.fat > 0 }

        let normalizedFoods = safeFoods.isEmpty ? foods : safeFoods
        let computedTotals = normalizedFoods.reduce(into: NutritionInfo.zero) { acc, item in
            acc.calories += item.calories
            acc.protein += item.protein
            acc.carbs += item.carbs
            acc.fat += item.fat
        }

        return GeminiFoodResponse(
            foods: normalizedFoods,
            totalCalories: validOrFallback(response.totalCalories, fallback: computedTotals.calories),
            totalProtein: validOrFallback(response.totalProtein, fallback: computedTotals.protein),
            totalCarbs: validOrFallback(response.totalCarbs, fallback: computedTotals.carbs),
            totalFat: validOrFallback(response.totalFat, fallback: computedTotals.fat)
        )
    }

    private func mapToDetectedFoods(_ items: [GeminiFoodItem]) -> [DetectedFood] {
        items.map { item in
            let category = NutritionDatabase.category(for: item.name)

            let modelNutrition = NutritionInfo(
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                fiber: 0
            )

            let safeNutrition: NutritionInfo
            if item.calories == 0 && item.protein == 0 && item.carbs == 0 && item.fat == 0 {
                safeNutrition = NutritionDatabase.lookup(name: item.name, grams: item.grams)
            } else {
                safeNutrition = modelNutrition
            }

            return DetectedFood(
                name: item.name,
                estimatedGrams: item.grams,
                confidence: item.confidence / 100.0,
                category: category,
                nutrition: safeNutrition
            )
        }
    }

    private func extractJSONObject(from text: String) -> String? {
        guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}") else {
            return nil
        }
        return String(text[start...end])
    }

    private func validOrFallback(_ value: Double, fallback: Double) -> Double {
        guard value.isFinite, value >= 0 else { return max(0, fallback) }
        return value
    }

    private func isRetryable(_ error: Error) -> Bool {
        guard let geminiError = error as? GeminiVisionError else { return false }
        switch geminiError {
        case .invalidJSON, .invalidResponse:
            return true
        default:
            return false
        }
    }

    private func safeFallbackResult() -> GeminiAnalysisResult {
        let fallbackNutrition = NutritionDatabase.lookup(name: "Meal", grams: 200)
        let fallbackFood = DetectedFood(
            name: "Estimated Meal",
            estimatedGrams: 200,
            confidence: 0.15,
            category: .other,
            nutrition: fallbackNutrition
        )
        return GeminiAnalysisResult(foods: [fallbackFood], totals: fallbackNutrition)
    }

    private func prepareImageData(_ image: UIImage) -> Data? {
        let resized = resizedImageIfNeeded(image, maxDimension: maxImageDimension)
        let qualities: [CGFloat] = [0.85, 0.75, 0.65, 0.55, 0.45]

        var bestData: Data?
        for quality in qualities {
            guard let data = resized.jpegData(compressionQuality: quality) else { continue }
            bestData = data
            if data.count <= maxImageBytes {
                return data
            }
        }
        return bestData
    }

    private func resizedImageIfNeeded(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let width = image.size.width
        let height = image.size.height
        let maxSide = max(width, height)
        guard maxSide > maxDimension else { return image }

        let scale = maxDimension / maxSide
        let newSize = CGSize(width: width * scale, height: height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}

private struct GeminiRequestPayload: Encodable {
    let contents: [Content]

    struct Content: Encodable {
        let parts: [Part]
    }

    struct Part: Encodable {
        let text: String?
        let inlineData: InlineData?

        enum CodingKeys: String, CodingKey {
            case text
            case inlineData = "inline_data"
        }

        static func text(_ value: String) -> Part {
            Part(text: value, inlineData: nil)
        }

        static func inlineData(_ value: InlineData) -> Part {
            Part(text: nil, inlineData: value)
        }
    }

    struct InlineData: Encodable {
        let mimeType: String
        let data: String

        enum CodingKeys: String, CodingKey {
            case mimeType = "mime_type"
            case data
        }
    }
}

private struct GeminiGenerateResponse: Decodable {
    let candidates: [GeminiCandidate]?
}

private struct GeminiCandidate: Decodable {
    let content: GeminiContent
}

private struct GeminiContent: Decodable {
    let parts: [GeminiPart]
}

private struct GeminiPart: Decodable {
    let text: String?
}

private struct GeminiAPIErrorEnvelope: Decodable {
    let error: GeminiAPIError
}

private struct GeminiAPIError: Decodable {
    let message: String?
}
