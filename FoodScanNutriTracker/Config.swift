import Foundation

enum Config {
    // Optional fallback for personal use. Prefer storing the key in UserDefaults.
    static let GEMINI_API_KEY: String = ""
    static let GEMINI_API_KEY_USER_DEFAULTS_KEY = "gemini_api_key"
}
