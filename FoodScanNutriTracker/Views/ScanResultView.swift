import SwiftData
import SwiftUI

struct ScanResultView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Bindable var viewModel: ScanViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                Color.appBackground.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 0) {
                        imageHeader

                        VStack(spacing: 16) {
                            totalCard
                            mealNameField
                            foodsList
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 20)
                        .padding(.bottom, 100)
                    }
                }

                VStack {
                    Spacer()
                    saveButton
                        .padding(.horizontal, 16)
                        .padding(.bottom, 32)
                }
            }
            .navigationTitle("Scan Result")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Retake") {
                        viewModel.showResult = false
                        viewModel.selectedImage = nil
                        viewModel.detectedFoods = []
                    }
                    .foregroundStyle(.white.opacity(0.7))
                }
            }
        }
    }

    @ViewBuilder
    private var imageHeader: some View {
        if let image = viewModel.selectedImage {
            Color.cardBackground
                .frame(height: 260)
                .overlay {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .allowsHitTesting(false)
                }
                .overlay(alignment: .bottom) {
                    LinearGradient(
                        colors: [.clear, Color.appBackground.opacity(0.95)],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(height: 100)
                    .allowsHitTesting(false)
                }
        }
    }

    private var totalCard: some View {
        let nutrition = viewModel.totalNutrition
        return VStack(spacing: 16) {
            HStack {
                Text("Total Nutrition")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(viewModel.detectedFoods.count) items")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.4))
            }

            HStack(spacing: 0) {
                TotalMacroCell(value: nutrition.calories, label: "Calories", color: .neonGreen, isBig: true)
                Divider().background(Color.white.opacity(0.08)).frame(height: 50)
                TotalMacroCell(value: nutrition.protein, label: "Protein", color: .proteinBlue)
                Divider().background(Color.white.opacity(0.08)).frame(height: 50)
                TotalMacroCell(value: nutrition.carbs, label: "Carbs", color: .carbAmber)
                Divider().background(Color.white.opacity(0.08)).frame(height: 50)
                TotalMacroCell(value: nutrition.fat, label: "Fat", color: .fatRed)
            }
        }
        .padding(20)
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.cardBorder, lineWidth: 1)
        )
    }

    private var mealNameField: some View {
        HStack(spacing: 12) {
            Image(systemName: "fork.knife")
                .foregroundStyle(Color.neonGreen)
                .frame(width: 20)
            TextField("Meal name", text: $viewModel.mealName)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.cardBorder, lineWidth: 1))
    }

    private var foodsList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Detected Foods")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Text("Tap grams to edit")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.35))
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            ForEach(viewModel.detectedFoods) { food in
                VStack(spacing: 0) {
                    FoodItemRow(food: food, onGramsChange: { newGrams in
                        viewModel.updateGrams(for: food.id, grams: newGrams)
                    })
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)

                    if food.id != viewModel.detectedFoods.last?.id {
                        Divider()
                            .background(Color.white.opacity(0.06))
                            .padding(.horizontal, 20)
                    }
                }
            }
        }
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.cardBorder, lineWidth: 1))
    }

    private var saveButton: some View {
        Button {
            viewModel.save(context: modelContext)
            dismiss()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                Text("Save Meal")
                    .font(.headline.weight(.bold))
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(Color.neonGreen)
            .clipShape(.rect(cornerRadius: 18))
            .shadow(color: Color.neonGreen.opacity(0.4), radius: 16, y: 6)
        }
    }
}

struct TotalMacroCell: View {
    let value: Double
    let label: String
    let color: Color
    var isBig: Bool = false

    var body: some View {
        VStack(spacing: 4) {
            Text(isBig ? "\(Int(value))" : "\(Int(value))g")
                .font(.system(size: isBig ? 22 : 17, weight: .bold, design: .rounded))
                .foregroundStyle(isBig ? color : .white)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.45))
        }
        .frame(maxWidth: .infinity)
    }
}
