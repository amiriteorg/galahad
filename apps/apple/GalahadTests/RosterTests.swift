import Foundation
import Testing
@testable import Galahad

/// The Roundtable says what the PWA says (`apps/web/src/lib/roster.ts`, `lib/now.ts`), and draws each knight as core
/// chooses (`avatarLook`): checked against their own output.
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

    @Test func eachKnightWearsTheDrawingCoreChooses() {
        for item in vectors.looks {
            #expect(AvatarLook.of(id: item.id, name: item.name, profile: item.avatar) == item.look, "\(item.id) \(item.name)")
        }
    }
}
