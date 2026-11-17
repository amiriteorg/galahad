import Foundation
import Testing
@testable import Galahad

/// The node's notices in the Inbox (Core/Notices.swift): read as the node sends them, those still open, and each said
/// by how much it matters and where it came from.
struct NoticesTests {
    static let listed = #"""
    {"notices":[
      {"key":"rule:pushes:q-1","severity":"info","title":"Your rule pushes: a command it matches has run","body":"In one of his quests (q-1), and it succeeded:\n$ git push origin main","source":"rule:pushes","node":null,"at":1763380000000,"dismissed":false},
      {"key":"disk:n-abc","severity":"warn","title":"Disk nearly full","body":"","source":"heartbeat","node":"n-abc","at":1763370000000,"dismissed":true}
    ]}
    """#

    struct Listed: Decodable { let notices: [NoticeView] }

    @Test func aNoticeIsReadAsTheNodeSendsItAndOnlyThoseStillOpenAreShown() throws {
        let notices = try JSONDecoder().decode(Listed.self, from: Data(Self.listed.utf8)).notices
        #expect(notices.map(\.key) == ["rule:pushes:q-1", "disk:n-abc"])
        #expect(notices[1].node == "n-abc" && notices[0].node == nil)
        #expect(Notices.open(notices).map(\.key) == ["rule:pushes:q-1"])
    }

    @Test func eachIsSaidByHowMuchItMattersAndWhereItCameFrom() throws {
        let notices = try JSONDecoder().decode(Listed.self, from: Data(Self.listed.utf8)).notices
        #expect(Notices.symbol(notices[0]) == "bell.fill")
        #expect(Notices.symbol(notices[1]) == "exclamationmark.triangle.fill")
        #expect(Notices.from("rule:pushes") == "Your rule pushes")
        #expect(Notices.from("loop:morning") == "The loop morning")
        #expect(Notices.from("heartbeat") == "The heartbeat")
        #expect(Notices.from("rule:") == "rule:")
        #expect(Notices.from("something-new") == "something-new")
    }
}
