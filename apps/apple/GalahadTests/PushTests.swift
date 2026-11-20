import Foundation
import Testing
@testable import Galahad

/// The iPhone app's notifications as data: which of Apple's services this build answers to, the token's form, and where
/// a tap leads (the node's side: packages/node/test/apns-send.test.ts).
struct PushTests {
    /// A provisioning profile as Apple signs one: the plist inside a CMS envelope (here, bytes around it).
    private func profile(_ aps: String?) -> Data {
        let entitlements = aps.map { "<key>aps-environment</key><string>\($0)</string>" } ?? ""
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict><key>Name</key><string>Galahad</string><key>Entitlements</key><dict>\(entitlements)</dict></dict></plist>
        """
        return Data([0x30, 0x82, 0x01, 0x00]) + Data(plist.utf8) + Data([0xa0, 0x00, 0x31, 0x02])
    }

    @Test func theServiceIsTheOneTheProfileNames() {
        for simulator in [false, true] {
            #expect(Push.environment(profile: profile("production"), simulator: simulator) == "production")
            #expect(Push.environment(profile: profile("development"), simulator: simulator) == "development")
            // One without push, or one that can't be read: Apple's development service.
            #expect(Push.environment(profile: profile(nil), simulator: simulator) == "development")
            #expect(Push.environment(profile: Data("not a profile".utf8), simulator: simulator) == "development")
        }
    }

    @Test func withNoProfileATestFlightBuildIsProductionsAndTheSimulatorDevelopments() {
        // TestFlight and the App Store take the profile out: their tokens are Apple's own service's.
        #expect(Push.environment(profile: nil, simulator: false) == "production")
        #expect(Push.environment(profile: nil, simulator: true) == "development")
    }

    @Test func theTokenIsLowercaseHex() {
        #expect(Push.hex(Data([0x00, 0xab, 0x10, 0xff])) == "00ab10ff")
        #expect(Push.hex(Data(repeating: 0xcd, count: 32)).count == 64)
    }

    @Test func aTapOpensOnlyWhatTheNodesListNames() {
        let conversation = "cv_" + String(repeating: "A", count: 22)
        #expect(Push.destination(["galahad": ["v": 1, "open": "inbox"]]) == .inbox)
        #expect(Push.destination(["galahad": ["v": 1, "open": "chat", "conversation": conversation]]) == .chat(conversation))
        #expect(Push.destination(["galahad": ["v": 1, "open": "chat", "conversation": "../../etc"]]) == .chat(nil))
        #expect(Push.destination(["galahad": ["v": 1, "open": "overview"]]) == .overview)
        #expect(Push.destination(["galahad": ["v": 1, "open": "settings"]]) == .settings)
        // Not ours, another version, or a place the list doesn't have: the Inbox.
        #expect(Push.destination(["aps": ["alert": "hi"]]) == .inbox)
        #expect(Push.destination(["galahad": ["v": 2, "open": "chat"]]) == .inbox)
        #expect(Push.destination(["galahad": ["v": 1, "open": "https://example.com"]]) == .inbox)
    }

    @Test func aButtonAnswersOnlyTheActionItsApprovalNames() {
        let id = "a_1234567890123456789012"
        #expect(Push.action(["galahad": ["v": 1, "kind": "approval", "action": id]]) == id)
        // Read as strictly as the node writes it: an approval's own, an action id's shape, nothing else.
        #expect(Push.action(["galahad": ["v": 1, "kind": "finished", "action": id]]) == nil)
        #expect(Push.action(["galahad": ["v": 1, "kind": "approval", "action": "../../actions"]]) == nil)
        #expect(Push.action(["galahad": ["v": 2, "kind": "approval", "action": id]]) == nil)
        #expect(Push.action(["aps": ["category": "approval"]]) == nil)
    }
}
