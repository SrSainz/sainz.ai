import Foundation
import Observation

@Observable
final class UserGoalsViewModel {
    var calorieGoal: Double {
        get { Double(UserDefaults.standard.integer(forKey: "calorieGoal").nonZero ?? 2000) }
        set { UserDefaults.standard.set(Int(newValue), forKey: "calorieGoal") }
    }

    var proteinGoal: Double {
        get { Double(UserDefaults.standard.integer(forKey: "proteinGoal").nonZero ?? 150) }
        set { UserDefaults.standard.set(Int(newValue), forKey: "proteinGoal") }
    }

    var carbsGoal: Double {
        get { Double(UserDefaults.standard.integer(forKey: "carbsGoal").nonZero ?? 250) }
        set { UserDefaults.standard.set(Int(newValue), forKey: "carbsGoal") }
    }

    var fatGoal: Double {
        get { Double(UserDefaults.standard.integer(forKey: "fatGoal").nonZero ?? 65) }
        set { UserDefaults.standard.set(Int(newValue), forKey: "fatGoal") }
    }
}

private extension Int {
    var nonZero: Int? { self == 0 ? nil : self }
}
