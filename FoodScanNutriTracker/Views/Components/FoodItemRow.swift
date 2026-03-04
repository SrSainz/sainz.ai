import SwiftUI

struct FoodItemRow: View {
    let food: DetectedFood
    var onGramsChange: ((Double) -> Void)? = nil

    @State private var gramsText: String = ""
    @State private var isEditing: Bool = false

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(categoryColor(food.category).opacity(0.15))
                    .frame(width: 44, height: 44)
                Text(food.category.emoji)
                    .font(.title3)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(food.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text("\(Int(food.nutrition.calories)) kcal")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.neonGreen)
                    Text("P:\(Int(food.nutrition.protein))g  C:\(Int(food.nutrition.carbs))g  F:\(Int(food.nutrition.fat))g")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.45))
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                if let onChange = onGramsChange {
                    HStack(spacing: 4) {
                        if isEditing {
                            TextField("g", text: $gramsText)
                                .keyboardType(.decimalPad)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 48)
                                .multilineTextAlignment(.trailing)
                                .onSubmit {
                                    commitGrams(onChange)
                                }
                        } else {
                            Text("\(Int(food.estimatedGrams))")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                        }
                        Text("g")
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.45))
                    }
                    .onTapGesture {
                        gramsText = "\(Int(food.estimatedGrams))"
                        isEditing = true
                    }
                } else {
                    Text("\(Int(food.estimatedGrams))g")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white.opacity(0.6))
                }

                ConfidenceBadge(confidence: food.confidence)
            }
        }
        .padding(.vertical, 4)
    }

    private func commitGrams(_ onChange: (Double) -> Void) {
        if let val = Double(gramsText), val > 0 {
            onChange(val)
        }
        isEditing = false
    }

    private func categoryColor(_ cat: FoodCategory) -> Color {
        switch cat {
        case .protein: return .proteinBlue
        case .carb: return .carbAmber
        case .vegetable: return .neonGreen
        case .fruit: return .pink
        case .dairy: return .cyan
        case .fat: return .orange
        case .beverage: return .purple
        case .other: return .gray
        }
    }
}

struct ConfidenceBadge: View {
    let confidence: Double

    var body: some View {
        Text("\(Int(confidence * 100))%")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .clipShape(Capsule())
    }

    private var color: Color {
        if confidence >= 0.85 { return .neonGreen }
        if confidence >= 0.65 { return .carbAmber }
        return .fatRed
    }
}
