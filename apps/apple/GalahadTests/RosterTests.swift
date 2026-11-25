import Foundation
import Testing
@testable import Galahad

/// The Roundtable says what the PWA says (`apps/web/src/lib/roster.ts`, `lib/now.ts`): checked against its own output.
struct RosterTests {
    let vectors = Vectors.shared
    var roundtable: Vectors.Roundtable { vectors.roundtable }

    @Test func everyKnightsLineAndMarkAreThePWAs() {
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: roundtable.asks)
        #expect(rows.map(\.id) == roundtable.rows.map(\.id))
        for (row, expected) in zip(rows, roundtable.rows) {
            #expect(row.line == expected.line, "\(row.id)")
            #expect(row.needs == expected.needs, "\(row.id)")
        }
    }

    @Test func everyKnightsStateIsThePWAs() {
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: roundtable.asks, now: roundtable.now)
        #expect(rows.map(\.id) == roundtable.rows.map(\.id))
        for (row, expected) in zip(rows, roundtable.rows) {
            #expect(row.standing.rawValue == expected.state, "\(row.id)")
        }
        for item in roundtable.galahad {
            #expect(Standing.of(GalahadNow(item.input), answering: false).rawValue == item.state, "\(item.text)")
        }
    }

    @Test func whatIsNewToYouIsWhatThePWASays() {
        let unread = vectors.unread
        let knights = Roster.rows(snapshot: unread.snapshot, asks: [], now: roundtable.now)
        let rooms = Roster.roomRows(snapshot: unread.snapshot)
        let expected = unread.rows
        #expect(knights.map(\.id) == expected.filter { $0.kind == "knight" }.map(\.id))
        for (row, want) in zip(knights, expected.filter { $0.kind == "knight" }) {
            #expect(row.unread == want.unread, "\(row.id)")
            #expect(row.standing.rawValue == want.state, "\(row.id)")
            #expect(row.line == want.line, "\(row.id)")
        }
        // (The PWA lists rooms the latest spoken in first, as the app does.)
        #expect(Set(rooms.map(\.id)) == Set(expected.filter { $0.kind == "room" }.map(\.id)))
        for room in rooms {
            let want = expected.first { $0.kind == "room" && $0.id == room.id }
            #expect(room.unread == want?.unread, "\(room.id)")
            #expect(room.needs == want?.needs, "\(room.id)")
        }
        // Both say something: some new, some not.
        #expect(expected.contains { $0.unread } && expected.contains { !$0.unread })
    }

    @Test func besideItsChipALineSaysWhatThePWASays() {
        #expect(!roundtable.besides.isEmpty)
        for item in roundtable.besides {
            #expect(Standing(rawValue: item.state)?.beside(item.line) == item.beside, "\(item.line)")
        }
    }

    @Test func aKnightsRowOpensItsOwnConversation() {
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: [])
        #expect(rows.first { $0.id == "ada" }?.room == "dm-ada")
        #expect(rows.first { $0.id == "dot" }?.room == nil)
    }

    @Test func galahadsLineIsThePWAs() {
        for item in roundtable.galahad {
            let now = GalahadNow(item.input)
            #expect(now.text == item.text)
            #expect(now.tone.rawValue == item.tone, "\(item.text)")
        }
    }

    @Test func whatWaitsOnGalahadIsTheInboxLessTheKnightsOwnAsks() {
        for item in roundtable.needs {
            #expect(Roster.galahadNeeds(inbox: item.inbox, asks: roundtable.asks, knights: item.knights) == item.needs)
        }
        #expect(Roster.knightOfCaller("arm:team.0123456789.max") == "max")
        #expect(Roster.knightOfCaller("arm:team.012345678.max") == nil)
        #expect(Roster.knightOfCaller("loop:morning") == nil)
    }
}
