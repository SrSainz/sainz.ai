import SwiftData
import SwiftUI

@main
struct FoodScanNutriTrackerApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([MealLog.self])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
    }
}
