import Foundation
import SwiftUI
import Testing
@testable import Galahad

/// Who sits where at the Roundtable (the one who leads first, then Galahad, then the rest in your order), your order
/// once you move knights, and where each knight stands at a glance.
struct SeatsTests {
    let roundtable = Vectors.shared.roundtable

    @Test func galahadLeadsUnlessAKnightOfYoursDoes() {
        let knights = ["ada", "kay", "lin"]
        #expect(Roster.seats(knights: knights, primary: nil) == ["galahad", "ada", "kay", "lin"])
        #expect(Roster.seats(knights: knights, primary: "galahad") == ["galahad", "ada", "kay", "lin"])
        // One that isn't a knight of yours (removed since, say) leads nothing: he does.
        #expect(Roster.seats(knights: knights, primary: "bors") == ["galahad", "ada", "kay", "lin"])
        #expect(Roster.seats(knights: [], primary: nil) == ["galahad"])
        #expect(Roster.leader(of: knights, primary: "galahad") == nil)
    }

    @Test func theKnightWhoLeadsComesFirstThenGalahadThenTheRestInYourOrder() {
        #expect(Roster.seats(knights: ["ada", "kay", "lin"], primary: "kay") == ["kay", "galahad", "ada", "lin"])
        #expect(Roster.seats(knights: ["ada", "kay", "lin"], primary: "lin") == ["lin", "galahad", "ada", "kay"])
        #expect(Roster.seats(knights: ["kay"], primary: "kay") == ["kay", "galahad"])
        #expect(Roster.leader(of: ["ada", "kay"], primary: "kay") == "kay")
    }

    @Test func movingKnightsDoesWhatAListDoesToItsRows() {
        let knights = ["a", "b", "c", "d", "e"]
        for offsets in Self.everyChoice(of: knights.count) {
            for destination in 0...knights.count {
                var moved = knights
                moved.move(fromOffsets: offsets, toOffset: destination)
                #expect(Roster.order(knights, leader: nil, moving: offsets, to: destination) == moved, "\(Array(offsets)) to \(destination)")
            }
        }
    }

    @Test func theOneWhoLeadsKeepsItsPlaceInYourOrder() {
        // Kay leads, so the rows under it are Ada, Lin and Max: Max moved to the top of them.
        let order = Roster.order(["ada", "kay", "lin", "max"], leader: "kay", moving: [2], to: 0)
        #expect(order == ["max", "kay", "ada", "lin"])
        #expect(Roster.seats(knights: order, primary: "kay") == ["kay", "galahad", "max", "ada", "lin"])
        // Whatever moves under it, it stays where it was in your order, where it goes back to when Galahad leads again.
        let knights = ["a", "lead", "b", "c", "d"]
        for offsets in Self.everyChoice(of: 4) {
            for destination in 0...4 {
                var rest = ["a", "b", "c", "d"]
                rest.move(fromOffsets: offsets, toOffset: destination)
                let order = Roster.order(knights, leader: "lead", moving: offsets, to: destination)
                #expect(order.firstIndex(of: "lead") == 1)
                #expect(order.filter { $0 != "lead" } == rest)
                #expect(Roster.seats(knights: order, primary: "lead") == ["lead", "galahad"] + rest)
            }
        }
    }

    @Test func eachStateIsSaidInAWordButRest() {
        // The colour is never the only sign: every state the ring colours has its word, and rest says none.
        for state in [Standing.working, .needs, .failed, .paused, .queued, .verified] { #expect(state.word?.isEmpty == false, "\(state)") }
        #expect(Standing.resting.word == nil)
        // Red where it needs you: what it waits for, and work gone wrong.
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: roundtable.asks, now: roundtable.now)
        for row in rows where row.standing == .needs || row.standing == .failed { #expect(row.needs, "\(row.id)") }
    }

    @Test func galahadSaysWhereHeStandsToo() {
        #expect(Standing.of(GalahadNow(GalahadWork(needs: 2)), answering: false) == .needs)
        #expect(Standing.of(GalahadNow(GalahadWork(turns: ["The release plan"])), answering: false) == .working)
        #expect(Standing.of(GalahadNow(GalahadWork(needs: 0)), answering: false) == .resting)
        // Writing an answer here, which no node's line knows of yet, is work too; what needs you still comes first.
        #expect(Standing.of(GalahadNow(GalahadWork(needs: 0)), answering: true) == .working)
        #expect(Standing.of(GalahadNow(GalahadWork(answering: true, needs: 1)), answering: true) == .needs)
    }

    @Test func aSnapshotCarriesYourOrderAndWhoLeads() throws {
        let snapshot = try JSONDecoder().decode(TeamSnapshot.self, from: Data(#"{"teammates":[],"rooms":[],"tasks":[],"deliveries":[],"order":["kay","ada"],"primary":"kay"}"#.utf8))
        #expect(snapshot.order == ["kay", "ada"])
        #expect(snapshot.primary == "kay")
        // An older node says neither: no order of yours, and Galahad leads.
        let older = try JSONDecoder().decode(TeamSnapshot.self, from: Data(#"{"teammates":[],"rooms":[],"tasks":[],"deliveries":[]}"#.utf8))
        #expect(older.order == nil)
        #expect(older.primary == nil)
    }

    @MainActor @Test func anArrangementIsShownAtOnceAndPutBackWhenItIsRefused() async throws {
        let tag = "org.amirite.galahad.tests.arrange"
        defer { try? DeviceKey.delete(tag: tag) }
        // A node that isn't there: nothing listens on this port of this machine, so the change never holds.
        let node = PairedNode(origin: try #require(URL(string: "http://127.0.0.1:9")), device: "c_tests", name: "Tests", fleet: "tests")
        let session = Session(key: try DeviceKey.create(tag: tag), node: node)
        let saving = Task.immediate { try await session.arrange(order: ["kay", "ada"], primary: "kay") }
        #expect(session.arranging == Arrangement(order: ["kay", "ada"], primary: "kay"))
        await #expect(throws: (any Error).self) { try await saving.value }
        #expect(session.arranging == nil)
        #expect(session.primary == "galahad")
    }

    @Test func anArrangementSaysOnlyWhatChanges() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        #expect(String(decoding: try encoder.encode(Arrangement(primary: "kay")), as: UTF8.self) == #"{"primary":"kay"}"#)
        #expect(String(decoding: try encoder.encode(Arrangement(order: ["kay", "ada"])), as: UTF8.self) == #"{"order":["kay","ada"]}"#)
    }

    /// Every non-empty choice of rows among `count`.
    private static func everyChoice(of count: Int) -> [IndexSet] {
        (1..<(1 << count)).map { mask in IndexSet((0..<count).filter { mask & (1 << $0) != 0 }) }
    }
}
