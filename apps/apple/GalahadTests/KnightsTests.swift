import Foundation
import Testing
@testable import Galahad

/// Seating and keeping knights and rooms says what the PWA says (`lib/team.ts`, `lib/roster.ts`, core's `avatar.ts`):
/// checked against their own output.
struct KnightsTests {
    let vectors = Vectors.shared

    @Test func everyRoomsLineAndMarkAreThePWAs() {
        let rows = Roster.roomRows(snapshot: vectors.rooms.snapshot)
        #expect(rows.map(\.id) == vectors.rooms.rows.map(\.id))
        for (row, expected) in zip(rows, vectors.rooms.rows) {
            #expect(row.line == expected.line, "\(row.id)")
            #expect(row.needs == expected.needs, "\(row.id)")
        }
    }

    @Test func aKnightsOwnConversationIsNoRoomOfTheRoundtable() {
        #expect(!Roster.roomRows(snapshot: vectors.rooms.snapshot).contains { $0.id == "dm-ada" })
    }

    @Test func aNewKnightsHandleIsThePWAs() {
        for item in vectors.knightForms.handles {
            #expect(Knights.handle(name: item.name, taken: item.taken) == item.handle, "\(item.name)")
            #expect(Knights.isHandle(item.handle), "\(item.handle)")
        }
    }

    @Test func removingAKnightSaysWhatThePWASays() {
        for item in vectors.knightForms.removals {
            let plan = Knights.removal(id: item.id, name: item.name, workspace: item.workspace, workspaceNode: item.workspaceNode, maySandbox: item.maySandbox)
            #expect(plan.blocked == item.plan.blocked)
            #expect(plan.lines == item.plan.lines)
            #expect(plan.destroyWorkspace == item.plan.destroyWorkspace)
        }
    }

    @Test func aLookIsSavedAsCoreSavesIt() throws {
        for item in vectors.knightForms.profiles {
            #expect(AvatarLook.profile(look: item.look, temperament: item.temperament) == item.profile, "\(item.look)")
        }
        // And chosen again from what was saved: the drawing it names is the one chosen.
        for look in AvatarLook.looks.map(\.id) {
            let saved = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(AvatarLook.profile(look: look, temperament: "calm")))
            #expect(AvatarLook.of(id: "someone", name: "Someone", profile: saved) == look)
        }
    }

    @Test func howLivelyAKnightIsAtRestIsCores() {
        for item in vectors.knightForms.temperaments {
            #expect(AvatarLook.temperament(id: item.id, profile: item.avatar) == item.temperament, "\(item.id)")
        }
    }

    @Test func aKnightIsSentWithAnEmptiedRepositoryAsNull() throws {
        let input = KnightInput(id: "ada", name: "Ada", instructions: "", repository: nil, harness: "native", role: "engineer", enabled: true, dailyTurns: 40, avatar: AvatarLook.profile(look: "bors", temperament: "calm"))
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        #expect(json["repository"] is NSNull)
        #expect(Set(json.keys) == ["id", "name", "instructions", "repository", "harness", "role", "enabled", "dailyTurns", "avatar"])
    }
}
