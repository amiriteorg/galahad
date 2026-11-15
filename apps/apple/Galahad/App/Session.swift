import Foundation
import Observation

/// A paired device's view of its node: who it is there, the Roundtable, and what waits for you. It asks the node again
/// on every refresh; each part keeps what it last had when an ask fails.
@MainActor @Observable final class Session {
    let key: DeviceKey
    let node: PairedNode
    let client: NodeClient

    private(set) var whoami: WhoAmI?
    private(set) var team: TeamSnapshot?
    /// Why the Roundtable couldn't be read, when it couldn't.
    private(set) var teamProblem: String?
    private(set) var actions: [ActionView] = []
    private(set) var requests: [SecretRequestView] = []
    private(set) var pairings: [PairingView] = []
    private(set) var turns: [TurnView] = []
    private(set) var quests: [QuestView] = []
    /// The Inbox has been read at least once, so its count means something.
    private(set) var inboxLoaded = false
    /// The node is away, or won't accept this device: said once, above everything.
    private(set) var trouble: NodeError?

    init(key: DeviceKey, node: PairedNode) {
        self.key = key
        self.node = node
        self.client = NodeClient(origin: node.origin, signer: key)
    }

    /// What this device may do (its scopes), as the node says; until it has said, the node is left to refuse.
    func can(_ scope: String) -> Bool { whoami?.scopes.contains(scope) ?? true }

    var waiting: [ActionView] { actions.filter { $0.waiting() } }
    var inboxCount: Int { waiting.count + requests.count + pairings.count }
    var asks: [Ask] { waiting.map { Ask(by: $0.by, connector: $0.connector, tool: $0.tool) } }
    var rows: [RosterRow] { team.map { Roster.rows(snapshot: $0, asks: asks) } ?? [] }

    /// Galahad's own line: the turns the node runs, the quests in hand, what waits on you.
    var galahad: GalahadNow {
        let knights = team?.teammates.map(\.id) ?? []
        return GalahadNow(GalahadWork(
            turns: turns.map(\.title),
            quests: quests.map(\.goal),
            needs: inboxLoaded ? Roster.galahadNeeds(inbox: inboxCount, asks: asks, knights: knights) : nil
        ))
    }

    func teammate(_ id: String) -> Teammate? { team?.teammates.first { $0.id == id } }

    func refresh() async {
        let client = self.client
        async let me = attempt { try await client.get("/api/whoami", as: WhoAmI.self) }
        async let team = attempt { try await client.get("/api/team", as: TeamSnapshot.self) }
        async let actions = attempt { try await client.get("/api/actions", as: Listed.self).actions ?? [] }
        async let requests = attempt { try await client.get("/api/secret-requests", as: Listed.self).requests ?? [] }
        async let pairings = attempt { try await client.get("/api/pairings", as: Listed.self).pairings ?? [] }
        async let turns = attempt { try await client.get("/api/turns", as: Listed.self).turns ?? [] }
        async let quests = attempt { try await client.get("/api/quests", as: Listed.self).quests ?? [] }

        switch await me {
        case .success(let me): (whoami, trouble) = (me, nil)
        case .failure(let error as NodeError): trouble = error
        case .failure: break
        }
        switch await team {
        case .success(let team): (self.team, teamProblem) = (team, nil)
        case .failure(let error as NodeError) where [404, 424, 501].contains(error.status): teamProblem = "This node seats no other knights yet."
        case .failure(let error): teamProblem = error.localizedDescription
        }
        let (acted, asked) = await (actions, requests)
        if case .success(let list) = acted { self.actions = list }
        if case .success(let list) = asked { self.requests = list }
        if case .success = acted, case .success = asked { inboxLoaded = true }
        if case .success(let list) = await pairings { self.pairings = list }
        if case .success(let list) = await turns { self.turns = list }
        if case .success(let list) = await quests { self.quests = list }
    }

    /// Your answer to an approval: nothing leaves until you approve it.
    func decide(_ action: ActionView, approve: Bool) async throws {
        struct Decision: Encodable { let id: String; let approve: Bool }
        _ = try await client.post("/api/actions/decide", Decision(id: action.id, approve: approve), as: JSONValue.self)
        await refresh()
    }

    /// Seals a key Galahad asked for: the node keeps it in the vault, and he learns that it exists, never what it is.
    func seal(_ request: SecretRequestView, value: String) async throws {
        struct Secret: Encodable { let name: String; let value: String; let provider: String? }
        _ = try await client.post("/api/secrets", Secret(name: request.name, value: value, provider: request.provider), as: JSONValue.self)
        await refresh()
    }

    /// Lets a device in (only when its code matches the one it shows), or turns it away.
    func answer(_ pairing: PairingView, approve: Bool) async throws {
        struct Answer: Encodable { let invite: String; let device: String }
        _ = try await client.post(approve ? "/api/pairings/approve" : "/api/pairings/reject", Answer(invite: pairing.invite, device: pairing.device), as: JSONValue.self)
        await refresh()
    }

    /// The lists the node answers with, each under its own name.
    private struct Listed: Decodable {
        var actions: [ActionView]?
        var requests: [SecretRequestView]?
        var pairings: [PairingView]?
        var turns: [TurnView]?
        var quests: [QuestView]?
    }
}

private func attempt<T: Sendable>(_ work: @Sendable () async throws -> T) async -> Result<T, any Error> {
    do {
        return .success(try await work())
    } catch {
        return .failure(error)
    }
}
