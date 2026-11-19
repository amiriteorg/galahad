import Foundation
import Observation

/// A paired device's view of its node: who it is there, the Roundtable, what waits for you, and Galahad's chat. It asks
/// the node again on every refresh; each part keeps what it last had when an ask fails.
@MainActor @Observable final class Session {
    let key: DeviceKey
    let node: PairedNode
    let client: NodeClient
    let chat = ChatModel()

    private(set) var whoami: WhoAmI?
    private(set) var team: TeamSnapshot?
    /// Why the Roundtable couldn't be read, when it couldn't.
    private(set) var teamProblem: String?
    private(set) var actions: [ActionView] = []
    private(set) var requests: [SecretRequestView] = []
    private(set) var pairings: [PairingView] = []
    /// The facts about you he proposed, waiting for you (what you kept goes with every answer of his).
    private(set) var facts: [Fact] = []
    /// What the node noticed for you that you haven't dismissed: a heartbeat's finding, a rule of yours that told you.
    private(set) var notices: [NoticeView] = []
    /// His asks to use a Mac itself, and his sessions there while they last.
    private(set) var screenSessions: [ScreenSessionView] = []
    private(set) var turns: [TurnView] = []
    /// His chats with an answer you haven't read yet, on any device (his ring is green while there are some).
    private(set) var unreadChats: [UnreadChat] = []
    private(set) var quests: [QuestView] = []
    /// This period's model calls on the node at your prices, against your budget (nil: not read yet, or a node from
    /// before the meter).
    private(set) var usage: UsageMeter?
    /// The Inbox has been read at least once, so its count means something.
    private(set) var inboxLoaded = false
    /// The node is away, or won't accept this device: said once, above everything.
    private(set) var trouble: NodeError?
    /// Your order of the knights, or who leads, while the node is told it: shown over what it last answered.
    private(set) var arranging: Arrangement?
    /// Your changes to the arrangement so far: a snapshot asked for before the latest of them is stale, and isn't shown.
    private var arrangements = 0

    init(key: DeviceKey, node: PairedNode) {
        self.key = key
        self.node = node
        self.client = NodeClient(origin: node.origin, signer: key)
        // The chat on screen read: his answers in it stop being new here at once, not at the next look.
        chat.read = { [weak self] id in self?.noteRead(id) }
    }

    /// A chat of his read on this device (in any window): it is no longer counted new here.
    func noteRead(_ id: String) { unreadChats.removeAll { $0.id == id } }

    /// What this device may do (its scopes), as the node says; until it has said, the node is left to refuse.
    func can(_ scope: String) -> Bool { whoami?.scopes.contains(scope) ?? true }

    var waiting: [ActionView] { actions.filter { $0.waiting() } }
    var inboxCount: Int { waiting.count + requests.count + pairings.count + facts.count + notices.count + screenSessions.count }
    var asks: [Ask] { waiting.map { Ask(by: $0.by, connector: $0.connector, tool: $0.tool) } }
    var rows: [RosterRow] { team.map { Roster.rows(snapshot: $0, asks: asks) } ?? [] }

    /// Galahad's own line: what he's answering here, the turns the node runs, the quests in hand, what waits on you.
    var galahad: GalahadNow {
        let knights = team?.teammates.map(\.id) ?? []
        return GalahadNow(GalahadWork(
            answering: chat.answering,
            step: chat.step,
            turns: turns.map(\.title),
            quests: quests.map(\.goal),
            needs: inboxLoaded ? Roster.galahadNeeds(inbox: inboxCount, asks: asks, knights: knights) : nil,
            unread: unreadChats.map(\.title)
        ))
    }

    /// What Galahad's face shows: thinking while he answers here, asking while something waits for you.
    var galahadExpression: String { chat.answering ? "thinking" : galahad.tone == .warn ? "asking" : "idle" }
    /// Where he stands at a glance: the ring round his face, and his word.
    var galahadStanding: Standing { .of(galahad, answering: chat.answering) }

    /// Your knights' handles in your order: as you just arranged them while the node is told (less any knight removed
    /// since, and with any seated since after them), else as it lists them.
    var order: [String] {
        let here = team?.teammates.map(\.id) ?? []
        guard let mine = arranging?.order else { return here }
        return mine.filter(here.contains) + here.filter { !mine.contains($0) }
    }
    /// Who leads the Roundtable: `galahad`, or the knight you made primary.
    var primary: String { Roster.leader(of: order, primary: arranging?.primary ?? team?.primary) ?? "galahad" }
    /// Who sits where, top to bottom: the one who leads, Galahad next when a knight leads, then the rest in your order.
    var seats: [String] { Roster.seats(knights: order, primary: primary) }

    func teammate(_ id: String) -> Teammate? { team?.teammates.first { $0.id == id } }
    func room(_ id: String) -> TeamRoom? { team?.rooms.first { $0.id == id } }
    var roomRows: [RoomRow] { team.map { Roster.roomRows(snapshot: $0) } ?? [] }

    /// A node, by name where this device knows it: its own node's, else the start of its id.
    func nodeName(of id: String) -> String {
        id == whoami?.node ? (whoami?.nodeName ?? node.nodeName ?? id) : String(id.dropFirst(2).prefix(8))
    }

    func refresh() async {
        let client = self.client
        let arranged = arrangements
        async let me = attempt { try await client.get("/api/whoami", as: WhoAmI.self) }
        async let team = attempt { try await client.get("/api/team", as: TeamSnapshot.self) }
        async let actions = attempt { try await client.get("/api/actions", as: Listed.self).actions ?? [] }
        async let requests = attempt { try await client.get("/api/secret-requests", as: Listed.self).requests ?? [] }
        async let pairings = attempt { try await client.get("/api/pairings", as: Listed.self).pairings ?? [] }
        async let about = attempt { try await client.get("/api/about-you", as: AboutYou.self) }
        async let notices = attempt { try await client.get("/api/notices", as: Listed.self).notices ?? [] }
        async let screens = attempt { try await client.get("/api/screen/sessions", as: Listed.self).sessions ?? [] }
        async let turns = attempt { try await client.get("/api/turns", as: Listed.self) }
        async let quests = attempt { try await client.get("/api/quests", as: Listed.self).quests ?? [] }
        async let usage = attempt { try await client.get("/api/usage/meter", as: UsageMeter.self) }

        switch await me {
        case .success(let me): (whoami, trouble) = (me, nil)
        case .failure(let error as NodeError): trouble = error
        case .failure: break
        }
        switch await team {
        case .success(let team) where arranged == arrangements: (self.team, teamProblem) = (team, nil)
        // Asked for before your latest change to the arrangement: the refresh after it brings what the node keeps.
        case .success: break
        case .failure(let error as NodeError) where [404, 424, 501].contains(error.status): teamProblem = "This node seats no other knights yet."
        case .failure(let error): teamProblem = error.localizedDescription
        }
        let (acted, asked) = await (actions, requests)
        if case .success(let list) = acted { self.actions = list }
        if case .success(let list) = asked { self.requests = list }
        if case .success = acted, case .success = asked { inboxLoaded = true }
        if case .success(let list) = await pairings { self.pairings = list }
        if case .success(let about) = await about { self.facts = about.proposed }
        if case .success(let list) = await notices { self.notices = Notices.open(list) }
        if case .success(let list) = await screens { self.screenSessions = list.filter { $0.state == "waiting" || $0.state == "allowed" } }
        if case .success(let listed) = await turns {
            self.turns = listed.turns ?? []
            self.unreadChats = listed.unread ?? []
            // The chat on screen, as the node holds it, when anything kept changed on another device.
            await chat.noticed(chats: listed.chats, turns: self.turns, with: client)
        }
        if case .success(let list) = await quests { self.quests = list }
        if case .success(let meter) = await usage { self.usage = meter }
    }

    /// Your budget for the node's model calls (a line to watch, never a stop): a day's or a month's, or none.
    func setBudget(usd: Double?, per: String) async throws {
        struct Budget: Encodable {
            let usd: Double?
            let per: String
            // (None goes as null, never left out: the node takes null for no budget.)
            func encode(to encoder: any Encoder) throws {
                var keyed = encoder.container(keyedBy: Keys.self)
                try keyed.encode(usd, forKey: .usd)
                try keyed.encode(per, forKey: .per)
            }
            enum Keys: String, CodingKey { case usd, per }
        }
        usage = try await client.post("/api/usage/budget", Budget(usd: usd, per: per), as: UsageMeter.self)
    }

    /// Your answer to an approval: nothing leaves until you approve it. `edits`, with a yes: your own words in its texts
    /// (only those you changed); your version is what's sent, and the one asked is declined, saying which it became.
    func decide(_ action: ActionView, approve: Bool, edits: [String: String]? = nil) async throws {
        struct Decision: Encodable { let id: String; let approve: Bool; let edits: [String: String]? }
        _ = try await client.post("/api/actions/decide", Decision(id: action.id, approve: approve, edits: edits), as: JSONValue.self)
        await refresh()
    }

    /// Seals a key Galahad asked for: the node keeps it in the vault, and he learns that it exists, never what it is.
    func seal(_ request: SecretRequestView, value: String) async throws {
        struct Secret: Encodable { let name: String; let value: String; let provider: String? }
        _ = try await client.post("/api/secrets", Secret(name: request.name, value: value, provider: request.provider), as: JSONValue.self)
        await refresh()
    }

    /// Dismisses a key he asked for that no longer matters (or that you won't give): out of the Inbox until he asks again.
    func dismiss(_ request: SecretRequestView) async throws {
        struct Dismiss: Encodable { let name: String }
        _ = try await client.post("/api/secret-requests/dismiss", Dismiss(name: request.name), as: JSONValue.self)
        await refresh()
    }

    /// Lets a device in (only when its code matches the one it shows), or turns it away.
    func answer(_ pairing: PairingView, approve: Bool) async throws {
        struct Answer: Encodable { let invite: String; let device: String }
        _ = try await client.post(approve ? "/api/pairings/approve" : "/api/pairings/reject", Answer(invite: pairing.invite, device: pairing.device), as: JSONValue.self)
        await refresh()
    }

    /// Keeps a fact he proposed, in your words if you give them: it goes with every answer of his from then on.
    func keep(_ fact: Fact, text: String? = nil) async throws {
        struct Keep: Encodable { let id: String; let text: String? }
        _ = try await client.post("/api/about-you/keep", Keep(id: fact.id, text: text), as: JSONValue.self)
        await refresh()
    }

    /// Drops a fact he proposed: it was only his note, and it goes with no answer.
    func drop(_ fact: Fact) async throws {
        struct Forget: Encodable { let id: String }
        _ = try await client.post("/api/memories/forget", Forget(id: fact.id), as: JSONValue.self)
        await refresh()
    }

    /// Your answer to his ask to use a Mac itself: his for its minutes from now, or not.
    func decide(screen: ScreenSessionView, allow: Bool) async throws {
        struct Decision: Encodable { let id: String; let allow: Bool }
        _ = try await client.post("/api/screen/decide", Decision(id: screen.id, allow: allow), as: JSONValue.self)
        await refresh()
    }

    /// Ends his session on a Mac now: nothing of it is his after this.
    func end(screen: ScreenSessionView) async throws {
        struct End: Encodable { let id: String }
        _ = try await client.post("/api/screen/end", End(id: screen.id), as: JSONValue.self)
        await refresh()
    }

    /// Dismisses a notice: it stays quiet until it changes.
    func dismiss(_ notice: NoticeView) async throws {
        struct Dismiss: Encodable { let key: String }
        _ = try await client.post("/api/notices/dismiss", Dismiss(key: notice.key), as: JSONValue.self)
        await refresh()
    }

    // MARK: Seating and keeping knights and rooms (yours alone: the node takes these from an owner's device)

    /// A knight saved, new or changed; the Roundtable is asked again after.
    @discardableResult
    func save(knight: KnightInput) async throws -> Teammate {
        struct Saved: Decodable { let teammate: Teammate }
        let saved = try await client.post("/api/team/teammates", knight, as: Saved.self).teammate
        await refresh()
        return saved
    }

    /// A room saved, new or changed.
    @discardableResult
    func save(room: RoomInput) async throws -> TeamRoom {
        struct Saved: Decodable { let room: TeamRoom }
        let saved = try await client.post("/api/team/rooms", room, as: Saved.self).room
        await refresh()
        return saved
    }

    /// Pause, resume or stop a room's work, or a knight's (one of the two).
    func control(room: String? = nil, knight: String? = nil, _ action: String) async throws {
        struct Control: Encodable { let room: String?; let teammate: String?; let action: String }
        _ = try await client.post("/api/team/control", Control(room: room, teammate: knight, action: action), as: JSONValue.self)
        await refresh()
    }

    /// Your order of the knights (every handle, in order), or who leads the Roundtable (`galahad`, or a knight of yours):
    /// shown at once, then told to the node, which keeps it for every device. Refused, the Roundtable goes back to what
    /// the node keeps, and the error says why.
    func arrange(order: [String]? = nil, primary: String? = nil) async throws {
        let shown = Arrangement(order: order ?? arranging?.order, primary: primary ?? arranging?.primary)
        arranging = shown
        arrangements += 1
        do {
            _ = try await client.post("/api/team/arrange", Arrangement(order: order, primary: primary), as: Arrangement.self)
        } catch {
            if arranging == shown { arranging = nil }
            throw error
        }
        // What was asked for while the node was told is stale too.
        arrangements += 1
        await refresh()
        if arranging == shown { arranging = nil }
    }

    /// A knight taken off the Roundtable for good; its VM goes with it only when `destroyWorkspace` says so.
    func remove(knight: String, destroyWorkspace: Bool) async throws {
        struct Remove: Encodable { let id: String; let destroyWorkspace: Bool? }
        _ = try await client.post("/api/team/remove", Remove(id: knight, destroyWorkspace: destroyWorkspace ? true : nil), as: JSONValue.self)
        await refresh()
    }

    /// The model roles your Models page has, each with whether a model answers for it (nil: this device may not read them).
    /// The models a knight may be set to work on: the roster's, and each local one a node of the fleet serves, and where.
    /// Nil: a device that may not read them, or a node too old to say (its knights then keep their role's).
    func knightModels() async -> [Knights.ModelChoice]? {
        struct Choices: Decodable { let models: [Knights.ModelChoice] }
        guard can("mind:read"), let choices = try? await client.get("/api/team/models", as: Choices.self).models else { return nil }
        return choices
    }

    func roles() async -> [String: Knights.RoleInfo]? {
        struct Roster: Decodable { let roster: [String: Knights.RoleInfo] }
        guard can("mind:read"), let roster = try? await client.get("/api/roster", as: Roster.self).roster else { return nil }
        return roster
    }

    /// The lists the node answers with, each under its own name.
    private struct Listed: Decodable {
        var actions: [ActionView]?
        var requests: [SecretRequestView]?
        var pairings: [PairingView]?
        var notices: [NoticeView]?
        var sessions: [ScreenSessionView]?
        var turns: [TurnView]?
        /// Which writing of the chats this is (on `GET /api/turns`).
        var chats: String?
        /// His chats with an answer you haven't read (on `GET /api/turns`; absent from an older node).
        var unread: [UnreadChat]?
        var quests: [QuestView]?
    }

    /// A knight's page on screen: what ended there (its replies to you, its tasks) is no longer new, on any device.
    func read(knight id: String) async {
        struct Seen: Encodable { let knight: String }
        guard (try? await client.post("/api/team/seen", Seen(knight: id), as: JSONValue.self)) != nil else { return }
        await lookAtTeam()
    }

    /// A room on screen: what ended there is no longer new, on any device.
    func read(room id: String) async {
        struct Seen: Encodable { let room: String }
        guard (try? await client.post("/api/team/seen", Seen(room: id), as: JSONValue.self)) != nil else { return }
        await lookAtTeam()
    }

    /// The Roundtable as the node has it now, alone (after a change of yours, so it shows at once).
    private func lookAtTeam() async {
        let arranged = arrangements
        if let team = try? await client.get("/api/team", as: TeamSnapshot.self), arranged == arrangements { self.team = team }
    }
}

private func attempt<T: Sendable>(_ work: @Sendable () async throws -> T) async -> Result<T, any Error> {
    do {
        return .success(try await work())
    } catch {
        return .failure(error)
    }
}
