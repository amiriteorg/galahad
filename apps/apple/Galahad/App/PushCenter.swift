#if os(iOS)
import SwiftUI
import UIKit
import UserNotifications

/// The app's side of notifications: iOS's permission (asked only when you turn them on), Apple's token for this install
/// (which the node keeps as this device's), and the notification you tapped, for MainView to follow.
@MainActor @Observable final class PushCenter {
    static let shared = PushCenter()

    /// Which of Apple's push services this build answers to (its provisioning profile says).
    let environment = Push.environment(profile: Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) })
    private(set) var token: String?
    /// Where a tapped notification asked to go, until MainView has gone there.
    var opened: Push.Destination?
    private var waiting: [CheckedContinuation<String, any Error>] = []

    /// Asks you once (iOS's own prompt), then Apple, for this install's token.
    func register() async throws -> String {
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        guard granted else { throw PushProblem.declined }
        if let token { return token }
        return try await withCheckedThrowingContinuation { continuation in
            waiting.append(continuation)
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func registered(_ deviceToken: Data) {
        let hex = Push.hex(deviceToken)
        token = hex
        finish(.success(hex))
    }

    func failed(_ error: any Error) { finish(.failure(error)) }

    private func finish(_ result: Result<String, any Error>) {
        let continuations = waiting
        waiting = []
        for continuation in continuations { continuation.resume(with: result) }
    }
}

enum PushProblem: LocalizedError {
    case declined
    var errorDescription: String? { "Notifications are off for Galahad in the iPhone's Settings: turn them on there, then here." }
}

/// What iOS tells the app about notifications: Apple's token for this install, and a notification shown or tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushCenter.shared.registered(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        PushCenter.shared.failed(error)
    }

    /// While the app is open a notification still shows: it is often about something other than what is on screen.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let destination = Push.destination(response.notification.request.content.userInfo)
        await MainActor.run { PushCenter.shared.opened = destination }
    }
}
#endif
