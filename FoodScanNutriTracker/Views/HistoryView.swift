import SwiftData
import SwiftUI
import UIKit

struct HistoryView: View {
    @Query(sort: \MealLog.date, order: .reverse) private var allLogs: [MealLog]
    @Environment(\.modelContext) private var modelContext
    @State private var selectedLog: MealLog? = nil

    private var groupedLogs: [(Date, [MealLog])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: allLogs) { log in
            calendar.startOfDay(for: log.date)
        }
        return grouped.sorted { $0.key > $1.key }
    }

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()

            if allLogs.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 20, pinnedViews: .sectionHeaders) {
                        ForEach(groupedLogs, id: \.0) { date, logs in
                            Section {
                                daySectionCard(logs: logs)
                            } header: {
                                sectionHeader(date: date, logs: logs)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 40)
                }
            }
        }
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.large)
        .sheet(item: $selectedLog) { log in
            MealDetailSheet(log: log)
        }
    }

    private func sectionHeader(date: Date, logs: [MealLog]) -> some View {
        HStack {
            Text(headerTitle(for: date))
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            Spacer()
            let totalCals = logs.reduce(0) { $0 + $1.totalCalories }
            Text("\(Int(totalCals)) kcal total")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.neonGreen)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 8)
        .background(Color.appBackground)
    }

    private func daySectionCard(logs: [MealLog]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(logs.enumerated()), id: \.element.id) { idx, log in
                Button {
                    selectedLog = log
                } label: {
                    HistoryMealRow(log: log)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        modelContext.delete(log)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }

                if idx < logs.count - 1 {
                    Divider().background(Color.white.opacity(0.06)).padding(.horizontal, 20)
                }
            }
        }
        .background(Color.cardBackground)
        .clipShape(.rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.cardBorder, lineWidth: 1))
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 56, weight: .thin))
                .foregroundStyle(.white.opacity(0.15))
            Text("No history yet")
                .font(.title3.weight(.bold))
                .foregroundStyle(.white.opacity(0.4))
            Text("Your logged meals will appear here")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.25))
        }
    }

    private func headerTitle(for date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: date)
    }
}

struct HistoryMealRow: View {
    let log: MealLog

    var body: some View {
        HStack(spacing: 14) {
            if let data = log.imageData, let image = UIImage(data: data) {
                Color(white: 0.15)
                    .frame(width: 50, height: 50)
                    .overlay {
                        Image(uiImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .allowsHitTesting(false)
                    }
                    .clipShape(.rect(cornerRadius: 11))
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 11)
                        .fill(Color.white.opacity(0.06))
                        .frame(width: 50, height: 50)
                    Image(systemName: "fork.knife")
                        .font(.callout)
                        .foregroundStyle(.white.opacity(0.3))
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(log.mealName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                HStack(spacing: 10) {
                    MacroChip(value: log.totalProtein, label: "P", color: .proteinBlue)
                    MacroChip(value: log.totalCarbs, label: "C", color: .carbAmber)
                    MacroChip(value: log.totalFat, label: "F", color: .fatRed)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text("\(Int(log.totalCalories))")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.neonGreen)
                Text(log.date, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.35))
            }
        }
    }
}

struct MacroChip: View {
    let value: Double
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(color)
            Text("\(Int(value))g")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(color.opacity(0.1))
        .clipShape(Capsule())
    }
}

struct MealDetailSheet: View {
    let log: MealLog
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.appBackground.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        if let data = log.imageData, let image = UIImage(data: data) {
                            Color.cardBackground
                                .frame(height: 220)
                                .overlay {
                                    Image(uiImage: image)
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .allowsHitTesting(false)
                                }
                                .clipShape(.rect(cornerRadius: 20))
                        }

                        HStack(spacing: 0) {
                            TotalMacroCell(value: log.totalCalories, label: "Calories", color: .neonGreen, isBig: true)
                            TotalMacroCell(value: log.totalProtein, label: "Protein", color: .proteinBlue)
                            TotalMacroCell(value: log.totalCarbs, label: "Carbs", color: .carbAmber)
                            TotalMacroCell(value: log.totalFat, label: "Fat", color: .fatRed)
                        }
                        .padding(.vertical, 20)
                        .background(Color.cardBackground)
                        .clipShape(.rect(cornerRadius: 20))
                        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.cardBorder, lineWidth: 1))

                        if !log.detectedFoods.isEmpty {
                            VStack(spacing: 0) {
                                HStack {
                                    Text("Food Items")
                                        .font(.headline.weight(.bold))
                                        .foregroundStyle(.white)
                                    Spacer()
                                }
                                .padding(.horizontal, 20)
                                .padding(.top, 20)
                                .padding(.bottom, 12)

                                ForEach(log.detectedFoods) { food in
                                    VStack(spacing: 0) {
                                        FoodItemRow(food: food)
                                            .padding(.horizontal, 20)
                                            .padding(.vertical, 10)
                                        if food.id != log.detectedFoods.last?.id {
                                            Divider().background(Color.white.opacity(0.06)).padding(.horizontal, 20)
                                        }
                                    }
                                }
                                .padding(.bottom, 12)
                            }
                            .background(Color.cardBackground)
                            .clipShape(.rect(cornerRadius: 20))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.cardBorder, lineWidth: 1))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 16)
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle(log.mealName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Color.neonGreen)
                }
            }
        }
    }
}
