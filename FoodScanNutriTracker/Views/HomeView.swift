import SwiftData
import SwiftUI
import UIKit

struct HomeView: View {
    @Query(sort: \MealLog.date, order: .reverse) private var allLogs: [MealLog]
    @State private var showScan: Bool = false
    @State private var goalsVM = UserGoalsViewModel()

    private var todayLogs: [MealLog] {
        let calendar = Calendar.current
        return allLogs.filter { calendar.isDateInToday($0.date) }
    }

    private var todayNutrition: NutritionInfo {
        todayLogs.reduce(.zero) { acc, log in
            NutritionInfo(
                calories: acc.calories + log.totalCalories,
                protein: acc.protein + log.totalProtein,
                carbs: acc.carbs + log.totalCarbs,
                fat: acc.fat + log.totalFat,
                fiber: acc.fiber + log.totalFiber
            )
        }
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.appBackground.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 20) {
                    headerSection
                    calorieCard
                    macroBreakdownCard
                    if !todayLogs.isEmpty {
                        todayMealsSection
                    } else {
                        emptyState
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }

            scanFAB
        }
        .fullScreenCover(isPresented: $showScan) {
            ScanView()
        }
    }

    private var headerSection: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.6))
                Text("Today's Nutrition")
                    .font(.title.weight(.bold))
                    .foregroundStyle(.white)
            }
            Spacer()
            ZStack {
                Circle()
                    .fill(Color.neonGreen.opacity(0.15))
                    .frame(width: 46, height: 46)
                Image(systemName: "leaf.fill")
                    .font(.title3)
                    .foregroundStyle(Color.neonGreen)
            }
        }
        .padding(.top, 8)
    }

    private var calorieCard: some View {
        VStack(spacing: 24) {
            MacroRingView(
                calories: todayNutrition.calories,
                goal: goalsVM.calorieGoal,
                protein: todayNutrition.protein,
                carbs: todayNutrition.carbs,
                fat: todayNutrition.fat
            )
        }
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.cardBorder, lineWidth: 1))
    }

    private var macroBreakdownCard: some View {
        VStack(spacing: 16) {
            HStack {
                Text("Macro Breakdown")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(todayLogs.count) meals")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.4))
            }

            VStack(spacing: 14) {
                MacroBarRow(label: "Protein", value: todayNutrition.protein, goal: goalsVM.proteinGoal, color: .proteinBlue)
                MacroBarRow(label: "Carbohydrates", value: todayNutrition.carbs, goal: goalsVM.carbsGoal, color: .carbAmber)
                MacroBarRow(label: "Fat", value: todayNutrition.fat, goal: goalsVM.fatGoal, color: .fatRed)
            }
        }
        .padding(20)
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.cardBorder, lineWidth: 1))
    }

    private var todayMealsSection: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Today's Meals")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 14)

            ForEach(todayLogs) { log in
                VStack(spacing: 0) {
                    MealLogRow(log: log)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)

                    if log.id != todayLogs.last?.id {
                        Divider().background(Color.white.opacity(0.06)).padding(.horizontal, 20)
                    }
                }
            }
        }
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.cardBorder, lineWidth: 1))
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "fork.knife.circle")
                .font(.system(size: 48, weight: .thin))
                .foregroundStyle(.white.opacity(0.2))
            Text("No meals logged today")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.35))
            Text("Tap the scan button to add your first meal")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.2))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
        .background(Color.cardBackground.opacity(0.5))
        .clipShape(.rect(cornerRadius: 24))
    }

    private var scanFAB: some View {
        Button {
            showScan = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "camera.viewfinder")
                    .font(.title3.weight(.semibold))
                Text("Scan Food")
                    .font(.callout.weight(.bold))
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 28)
            .padding(.vertical, 18)
            .background(Color.neonGreen)
            .clipShape(Capsule())
            .shadow(color: Color.neonGreen.opacity(0.45), radius: 20, y: 8)
        }
        .padding(.trailing, 20)
        .padding(.bottom, 24)
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning" }
        if hour < 17 { return "Good afternoon" }
        return "Good evening"
    }
}

struct MealLogRow: View {
    let log: MealLog

    var body: some View {
        HStack(spacing: 14) {
            if let data = log.imageData, let image = UIImage(data: data) {
                Color.cardBackground
                    .frame(width: 52, height: 52)
                    .overlay {
                        Image(uiImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .allowsHitTesting(false)
                    }
                    .clipShape(.rect(cornerRadius: 12))
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.neonGreen.opacity(0.1))
                        .frame(width: 52, height: 52)
                    Image(systemName: "fork.knife")
                        .font(.title3)
                        .foregroundStyle(Color.neonGreen.opacity(0.7))
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(log.mealName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text(log.date, style: .time)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text("\(Int(log.totalCalories))")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonGreen)
                Text("kcal")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
    }
}
