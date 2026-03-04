import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: Int = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                HomeView()
                    .tag(0)

                Color.clear
                    .tag(1)

                NavigationStack {
                    HistoryView()
                }
                .tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            customTabBar
        }
        .ignoresSafeArea(.keyboard)
    }

    private var customTabBar: some View {
        HStack(spacing: 0) {
            TabBarButton(
                icon: "house.fill",
                label: "Home",
                isSelected: selectedTab == 0
            ) { selectedTab = 0 }

            Spacer()

            ZStack {
                Circle()
                    .fill(Color.neonGreen)
                    .frame(width: 60, height: 60)
                    .shadow(color: Color.neonGreen.opacity(0.5), radius: 16, y: 4)
                Image(systemName: "camera.viewfinder")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.black)
            }
            .offset(y: -10)
            .onTapGesture { selectedTab = 1 }

            Spacer()

            TabBarButton(
                icon: "chart.bar.fill",
                label: "History",
                isSelected: selectedTab == 2
            ) { selectedTab = 2 }
        }
        .padding(.horizontal, 36)
        .padding(.top, 12)
        .padding(.bottom, 28)
        .background(
            ZStack {
                Color(red: 0.08, green: 0.08, blue: 0.09)
                Rectangle()
                    .fill(Color.white.opacity(0.05))
                    .frame(height: 1)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        )
        .fullScreenCover(
            isPresented: Binding(
                get: { selectedTab == 1 },
                set: { if !$0 { selectedTab = 0 } }
            )
        ) {
            ScanView()
        }
    }
}

struct TabBarButton: View {
    let icon: String
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color.neonGreen : Color.white.opacity(0.35))
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(isSelected ? Color.neonGreen : Color.white.opacity(0.35))
            }
        }
        .frame(width: 60)
    }
}
