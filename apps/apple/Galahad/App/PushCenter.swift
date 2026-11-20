#if os(iOS)
import SwiftUI
import UIKit
import UserNotifications

/// The app's side of notifications: iOS's permission (asked only when you turn them on), Apple's token for this install
/// (which the node keeps as this device's), and the notification you tapped, for MainView to follow.
@MainActor @Observable final class PushCenter {
    static let shared = PushCenter()

    /// Which of Apple's push services this build answers to (its provisioning profile says, when it carries one).
    let environment = Push.environment(profile: Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) }, simulator: PushCenter.simulator)

    private static var simulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }
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
    case unpaired
    var errorDescription: String? {
        switch self {
        case .declined: "Notifications are off for Galahad in the iPhone's Settings: turn them on there, then here."
        case .unpaired: "This iPhone isn't paired with your node."
        }
    }
}

/// What iOS tells the app about notifications: Apple's token for this install, and a notification shown or tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // An approval answered from its notification, here and on the Watch: each button behind the iPhone's own unlock.
        let approve = UNNotificationAction(identifier: Push.Button.approve, title: "Approve", options: [.authenticationRequired])
        let decline = UNNotificationAction(identifier: Push.Button.decline, title: "Decline", options: [.authenticationRequired, .destructive])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: Push.Button.approval, actions: [approve, decline], intentIdentifiers: []),
            UNNotificationCategory(identifier: Push.Button.declineOnly, actions: [decline], intentIdentifiers: []),
        ])
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
        let userInfo = response.notification.request.content.userInfo
        // A button pressed on the notification: the action answered there, without opening the app.
        if [Push.Button.approve, Push.Button.decline].contains(response.actionIdentifier), let action = Push.action(userInfo) {
            await Self.answer(action, approve: response.actionIdentifier == Push.Button.approve)
            return
        }
        let destination = Push.destination(userInfo)
        await MainActor.run { PushCenter.shared.opened = destination }
    }

    /// Your answer to an action, signed by this device as the Inbox's is; then a word of how it went (a failure says to
    /// open the app, where it still waits).
    private static func answer(_ action: String, approve: Bool) async {
        struct Decision: Encodable { let id: String; let approve: Bool }
        let said: (title: String, body: String)
        do {
            guard let key = try DeviceKey.load(), let node = PairedNode.load(), node.device == key.device else { throw PushProblem.unpaired }
            _ = try await NodeClient(origin: node.origin, signer: key).post("/api/actions/decide", Decision(id: action, approve: approve), as: JSONValue.self)
            said = approve ? ("Approved", "Galahad sends it once, as asked.") : ("Declined", "Nothing was sent.")
        } catch {
            said = ("Not answered", "\(error.localizedDescription) It still waits in your Inbox.")
        }
        let content = UNMutableNotificationContent()
        content.title = said.title
        content.body = said.body
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "answered-\(action)", content: content, trigger: nil))
    }
}
#endif
