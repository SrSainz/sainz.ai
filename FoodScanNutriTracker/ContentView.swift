import SwiftData
import SwiftUI

struct ContentView: View {
    var body: some View {
        MainTabView()
            .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: MealLog.self, inMemory: true)
}
