import Foundation

/// The iPhone app's notifications, as data: which of Apple's push services this build answers to, Apple's token as the
/// node takes it, and where a tap leads. The node sends them (packages/node/src/apns-send.ts); what a payload may open
/// is core's fixed list (notify-payload.ts), and anything else opens the Inbox.
enum Push {
    /// The service this build's provisioning profile names: `production` for TestFlight and the App Store, `development`
    /// for a build from Xcode. With no profile at all (the simulator), development.
    static func environment(profile: Data?) -> String {
        guard let profile,
              let start = profile.range(of: Data("<?xml".utf8)),
              let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: profile[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any],
              entitlements["aps-environment"] as? String == "production"
        else { return "development" }
        return "production"
    }

    /// Apple's token for this install, as the node takes it: lowercase hex.
    static func hex(_ token: Data) -> String { token.map { String(format: "%02x", $0) }.joined() }

    enum Destination: Equatable, Sendable {
        case inbox
        /// Galahad's chat: the kept one named, or his latest.
        case chat(String?)
        case overview
        case settings
    }

    /// Where a tapped notification opens: ours names one of the node's fixed places; anything else opens the Inbox.
    static func destination(_ userInfo: [AnyHashable: Any]) -> Destination {
        guard let ours = userInfo["galahad"] as? [String: Any], (ours["v"] as? Int) == 1 else { return .inbox }
        switch ours["open"] as? String {
        case "chat":
            let id = ours["conversation"] as? String
            return .chat(id.flatMap { $0.range(of: #"^cv_[A-Za-z0-9_-]{22}$"#, options: .regularExpression) != nil ? $0 : nil })
        case "overview": return .overview
        case "settings": return .settings
        default: return .inbox
        }
    }
}
