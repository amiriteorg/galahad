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

    @Test func theRolesAKnightMayBeGivenAreThePWAs() {
        #expect(!vectors.knightForms.roles.isEmpty)
        for item in vectors.knightForms.roles {
            #expect(Knights.roles(roster: item.roster, current: item.current) == item.roles, "\(item.current ?? "none")")
        }
        for item in vectors.knightForms.roleLines {
            #expect(Knights.roleLine(role: item.role, spec: item.spec) == item.line, "\(item.role)")
        }
    }

    @Test func aKnightsOwnModelsAreThePWAs() {
        #expect(!vectors.knightForms.modelChoices.isEmpty)
        for item in vectors.knightForms.modelChoices {
            #expect(Knights.modelChoices(item.choices, own: item.own ?? []) == item.offered, "\(item.own ?? [])")
        }
        for item in vectors.knightForms.modelToggles {
            #expect(Knights.toggle(item.own, item.ref, on: item.on) == item.after, "\(item.ref) \(item.on)")
        }
        for item in vectors.knightForms.modelLines {
            #expect(Knights.modelsLine(own: item.own, role: item.role, spec: item.spec, sensitive: item.sensitive ?? false) == item.line, "\(item.own)")
        }
        for item in vectors.knightForms.worksOn {
            #expect(Knights.worksOn(role: item.role, models: item.models, sensitive: item.sensitive ?? false) == item.words, "\(item.models ?? [])")
        }
    }

    @Test func aKnightsModelsAreSentOnlyToANodeThatKnowsThem() throws {
        var input = KnightInput(id: "ada", name: "Ada", instructions: "", repository: nil, harness: "native", role: "engineer", enabled: true, dailyTurns: 40)
        let without = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect(without?["models"] == nil)
        input.sendModels = true
        let cleared = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect(cleared?["models"] is NSNull)
        input.models = ["ollama/mimo-v2.6:9b", "deepseek/deepseek-v4-pro"]
        let chosen = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect(chosen?["models"] as? [String] == ["ollama/mimo-v2.6:9b", "deepseek/deepseek-v4-pro"])
        // Its keys are said only when they could be chosen (an older node would refuse them): then null for none.
        #expect(chosen?["keys"] == nil)
        input.sendKeys = true
        let none = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect(none?["keys"] is NSNull)
        input.keys = [.init(secret: "stripe", header: "authorization", write: false)]
        let given = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect((given?["keys"] as? [[String: Any]])?.first?["secret"] as? String == "stripe")
        // Sensitive mode is said only when it is set: left alone, nothing of it is sent.
        #expect(chosen?["sensitive"] == nil)
        input.sensitive = true
        let held = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect(held?["sensitive"] as? Bool == true)
    }

    @Test func aTasksBudgetIsReadAsThePWAReadsIt() {
        #expect(!vectors.knightForms.budgets.isEmpty)
        for item in vectors.knightForms.budgets {
            switch KnightRoom.budget(from: item.text) {
            case .success(let usd):
                #expect(item.error == nil, "\(item.text)")
                #expect(usd == item.usd, "\(item.text)")
            case .failure(let error):
                #expect(error.message == item.error, "\(item.text)")
            }
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

    @Test func aKnightIsSentWithAnEmptiedRepositoryAsNull() throws {
        let input = KnightInput(id: "ada", name: "Ada", instructions: "", repository: nil, harness: "native", role: "engineer", enabled: true, dailyTurns: 40)
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        #expect(json["repository"] is NSNull)
        // Its colour untouched is left out: the node keeps what it has (a new knight takes its handle's).
        #expect(Set(json.keys) == ["id", "name", "instructions", "repository", "harness", "role", "enabled", "dailyTurns"])
    }

    @Test func itsOrbsColourIsSentAsCoreSavesItAndNullGivesItsHandlesBack() throws {
        // (The PWA's avatarEditor: { v: 2, color } when you chose, null to reset, nothing when untouched.)
        var input = KnightInput(id: "ada", name: "Ada", instructions: "", repository: nil, harness: "native", role: "engineer", enabled: true, dailyTurns: 40, avatar: .chosen("#3abeff"))
        let chosen = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        let profile = try #require(chosen["avatar"] as? [String: Any])
        #expect(Set(profile.keys) == ["v", "color"])
        #expect(profile["v"] as? Int == 2)
        #expect(profile["color"] as? String == "#3abeff")
        // What was sent is what core takes as a chosen colour, and the colour the orb then has.
        let sent = try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: profile))
        #expect(KnightOrb.chosenColor(sent) == "#3abeff")
        let colors = KnightOrb.colors(id: "ada", profile: sent)
        #expect([colors.tint, colors.light, colors.deep] == ["#3abeff", "#93dbff", "#1c5b7a"] && colors.chosen)
        input.avatar = .handle
        let reset = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        #expect(reset.keys.contains("avatar"))
        #expect(reset["avatar"] is NSNull)
        input.avatar = nil
        let untouched = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        #expect(untouched["avatar"] == nil)
    }
}
