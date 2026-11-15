import SwiftUI
import UIKit

@main
struct GalahadApp: App {
    init() {
        // A count of what needs you is in Galahad's red, as everything that needs you is.
        UITabBarItem.appearance().badgeColor = UIColor(named: "Siege")
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
