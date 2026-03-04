import SwiftUI

struct MacroRingView: View {
    let calories: Double
    let goal: Double
    let protein: Double
    let carbs: Double
    let fat: Double

    private var progress: Double { min(calories / max(goal, 1), 1.0) }
    private var remaining: Double { max(goal - calories, 0) }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.07), lineWidth: 18)
                    .frame(width: 160, height: 160)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        AngularGradient(
                            colors: [Color.neonGreen.opacity(0.7), Color.neonGreen],
                            center: .center
                        ),
                        style: StrokeStyle(lineWidth: 18, lineCap: .round)
                    )
                    .frame(width: 160, height: 160)
                    .rotationEffect(.degrees(-90))
                    .animation(.spring(duration: 0.8), value: progress)

                VStack(spacing: 2) {
                    Text("\(Int(calories))")
                        .font(.system(size: 38, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("kcal")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.5))
                    Text("\(Int(remaining)) left")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.neonGreen)
                }
            }
            .padding(.bottom, 24)

            HStack(spacing: 0) {
                MacroPillView(label: "Protein", value: protein, unit: "g", color: .proteinBlue)
                Spacer()
                MacroPillView(label: "Carbs", value: carbs, unit: "g", color: .carbAmber)
                Spacer()
                MacroPillView(label: "Fat", value: fat, unit: "g", color: .fatRed)
            }
            .padding(.horizontal, 8)
        }
    }
}

struct MacroPillView: View {
    let label: String
    let value: Double
    let unit: String
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            Text("\(Int(value))\(unit)")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(label)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.white.opacity(0.5))

            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 32, height: 3)
        }
    }
}

struct MacroBarRow: View {
    let label: String
    let value: Double
    let goal: Double
    let color: Color

    private var progress: Double { min(value / max(goal, 1), 1.0) }

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text(label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.8))
                Spacer()
                Text("\(Int(value))g / \(Int(goal))g")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.5))
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.07))
                        .frame(height: 7)
                    Capsule()
                        .fill(color)
                        .frame(width: geo.size.width * progress, height: 7)
                        .animation(.spring(duration: 0.7), value: progress)
                }
            }
            .frame(height: 7)
        }
    }
}

extension Color {
    static let neonGreen = Color(red: 0.65, green: 0.93, blue: 0.35)
    static let proteinBlue = Color(red: 0.38, green: 0.60, blue: 1.0)
    static let carbAmber = Color(red: 1.0, green: 0.76, blue: 0.28)
    static let fatRed = Color(red: 1.0, green: 0.42, blue: 0.42)
    static let appBackground = Color(red: 0.05, green: 0.05, blue: 0.06)
    static let cardBackground = Color(red: 0.11, green: 0.11, blue: 0.13)
    static let cardBorder = Color.white.opacity(0.08)
}
