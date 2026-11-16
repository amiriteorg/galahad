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

    @Test func eachKnightSaysWhereItStandsInAWord() {
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: roundtable.asks, now: roundtable.now)
        let expected: [String: (Standing.Kind, String)] = [
            "ada": (.working, "Working"), "bea": (.working, "Working"),
            "cy": (.resting, "Resting"), "hal": (.resting, "Resting"), "ivy": (.resting, "Resting"), "lou": (.resting, "Resting"),
            // Work in hand that hasn't started yet.
            "gus": (.resting, "Queued"),
            "dot": (.paused, "Paused"), "ned": (.paused, "Paused"),
            // Held by its spent allowance, not by you.
            "eve": (.paused, "Out of turns"),
            "fay": (.failed, "Failed"), "jo": (.failed, "Failed"), "kit": (.failed, "Interrupted"),
            // Asking your leave, or your approval of work proposed.
            "max": (.waiting, "Needs you"), "oz": (.waiting, "Needs you"), "pip": (.waiting, "Needs you"),
        ]
        #expect(Set(rows.map(\.id)) == Set(expected.keys))
        for row in rows {
            guard let (kind, word) = expected[row.id] else { continue }
            #expect(row.standing == Standing(kind: kind, word: word), "\(row.id)")
        }
        // Red where it needs you: what it waits for, and work gone wrong.
        for row in rows where row.standing.kind == .waiting || row.standing.kind == .failed { #expect(row.needs, "\(row.id)") }
    }

    @Test func atWorkItSaysWhatItsEyesActOut() {
        #expect(Standing.working("thinking") == Standing(kind: .working, word: "Thinking"))
        #expect(Standing.working("checking") == Standing(kind: .working, word: "Checking"))
        #expect(Standing.working("browsing").word == "Browsing")
    }

    @Test func galahadSaysWhereHeStandsToo() {
        #expect(Standing.of(GalahadNow(GalahadWork(needs: 2)), answering: false) == .waiting)
        #expect(Standing.of(GalahadNow(GalahadWork(answering: true, step: "Reading sync.ts")), answering: true) == Standing(kind: .working, word: "Thinking"))
        #expect(Standing.of(GalahadNow(GalahadWork(turns: ["The release plan"])), answering: false) == Standing(kind: .working, word: "Working"))
        #expect(Standing.of(GalahadNow(GalahadWork(needs: 0)), answering: false) == .resting)
        // What needs you comes first, as on a knight's row.
        #expect(Standing.of(GalahadNow(GalahadWork(answering: true, needs: 1)), answering: true) == .waiting)
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
