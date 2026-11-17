import Foundation

/*
 * What the node answers, as far as this app reads it (`packages/core/src/api.ts`, `team.ts` and `turns.ts`). Fields a
 * newer node adds are passed over; a time is milliseconds since 1970 unless it says it is an HLC.
 */

/// `GET /api/whoami`: this device as the node knows it.
struct WhoAmI: Decodable, Sendable, Equatable {
    let device: String
    let kind: String
    let scopes: [String]
    let node: String
    let nodeName: String
    let fleet: String?
    let fleetName: String?
}

/// `GET /api/team`: the Roundtable's knights, their conversations and their work, in one snapshot.
struct TeamSnapshot: Decodable, Sendable {
    var teammates: [Teammate]
    var rooms: [TeamRoom]
    var tasks: [TeamTask]
    var deliveries: [TeamDelivery]
    var removed: [Removed]?
    /// Galahad's own computer, once he has one: his VM, made and watched as a knight's is (under his handle).
    var computer: Teammate.Workspace? = nil
    /// Your order of the knights (`teammates` comes in it already); absent from an older node.
    var order: [String]? = nil
    /// Who leads the Roundtable: `galahad`, or the knight you made primary (absent from an older node: Galahad).
    var primary: String? = nil

    struct Removed: Decodable, Sendable { let id: String; let name: String }
}

struct Teammate: Decodable, Sendable, Identifiable {
    let id: String
    let name: String
    let instructions: String
    let role: String
    /// Its own models, in place of its role's, in order (absent: its role's).
    var models: [String]? = nil
    let harness: String
    let enabled: Bool
    let dailyTurns: Int
    let turnsToday: Int
    let repository: String?
    /// The saved look, checked field by field before it names a drawing (`AvatarLook`).
    let avatar: JSONValue?
    /// Who made it: `owner` (also what its absence means), `galahad`, or the knight that did.
    let createdBy: String?
    /// Whose words its job is: `owner`, `galahad`, or the knight that made it (absent: yours).
    var instructionsBy: String? = nil
    /// Its VM, once it has one; `workspaceNode`, the host chosen for one being made.
    var workspace: Workspace? = nil
    var workspaceNode: String? = nil
    /// Its own working notes.
    var memory: String? = nil

    struct Workspace: Decodable, Sendable, Equatable { let node: String; let id: String }
}

/// Whose VM a screen or a terminal is: a knight's, or Galahad's own computer, under his reserved handle.
struct VMSeat: Sendable {
    let id: String
    let name: String
    /// Its sandbox, once it has one.
    let sandbox: String?

    init(_ knight: Teammate) {
        id = knight.id
        name = knight.name
        sandbox = knight.workspace?.id
    }

    /// Galahad's own computer.
    init(computer: Teammate.Workspace) {
        id = "galahad"
        name = "Galahad"
        sandbox = computer.id
    }
}

struct TeamRoom: Decodable, Sendable {
    let id: String
    let name: String
    let members: [String]
    let direct: Bool
    /// Replies its knights may give to one thing you say, handoffs between them included.
    var turnBudget: Int? = nil
    let paused: Bool
    let updatedAt: Double
}

struct TeamTask: Decodable, Sendable {
    struct Changes: Decodable, Sendable { let files: Int; let artifact: String? }
    let id: String
    let room: String
    let assignee: String
    let title: String
    let goal: String
    let dependsOn: [String]
    /// The commands that prove it done.
    var gates: [String]? = nil
    /// queued · running · done · failed · stopped · interrupted
    let status: String
    let verified: Bool
    let progress: String
    /// What the knight said of it when it ended, then the review's lines.
    var output: String? = nil
    let error: String?
    var createdAt: Double? = nil
    let updatedAt: Double
    let changes: Changes?
    /// Who gave it to the Roundtable rather than to a knight by name (owner or galahad).
    var givenBy: String? = nil
    /// The knight that proposed it in a conversation; while its status is `proposed` it waits for your approval.
    var proposedBy: String? = nil
}

/// A knight's reply on its way (or how it went).
struct TeamDelivery: Decodable, Sendable {
    let id: String
    let room: String
    let teammate: String
    let status: String
    let error: String?
    let updatedAt: Double
}

/// `GET /api/actions`: what his oath made him ask about. Only a waiting one is yours to answer.
struct ActionView: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let connector: String
    let tool: String
    let args: [String: JSONValue]
    /// read · create · modify · outward · delete
    let kind: String
    let target: String
    /// Who asked: `arm:…`, `loop:…`, `node:…`, `you`.
    let by: String
    let why: String?
    let node: String
    /// An HLC.
    let requestedAt: String
    /// Unanswered by then, and it's no.
    let expires: Double
    let state: String

    enum CodingKeys: String, CodingKey {
        case id, connector, tool, args, kind = "class", target, by, why, node, requestedAt, expires, state
    }

    func waiting(at now: Date = .now) -> Bool { state == "waiting" && expires > now.timeIntervalSince1970 * 1000 }
}

/// `GET /api/secret-requests`: a key Galahad asked for. He learns that it exists, never what it is.
struct SecretRequestView: Decodable, Sendable, Identifiable, Equatable {
    let name: String
    let provider: String?
    let purpose: String
    /// An HLC.
    let requestedAt: String
    let requestedBy: String
    var id: String { name }
}

/// `GET /api/notices`: something the node noticed for you (a heartbeat's finding, a rule of yours that told you), kept
/// until you dismiss it. Its title and body are the node's own words.
struct NoticeView: Decodable, Sendable, Identifiable, Equatable {
    let key: String
    /// alert · warn · info
    let severity: String
    let title: String
    let body: String
    /// What raised it: `heartbeat`, `loop:<name>`, `rule:<name>`, `ci`, `compute`.
    let source: String
    /// The node it is about, when it is about one.
    let node: String?
    /// When, in milliseconds.
    let at: Double
    let dismissed: Bool
    var id: String { key }
}

/// `GET /api/screen/sessions`: Galahad's ask to use a Mac itself, or his session there (core's screen.ts): his only
/// once you allow it, for its minutes from your answer, until you or he ends it.
struct ScreenSessionView: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let node: String
    let nodeName: String
    /// What he wants it for: his words.
    let why: String
    let minutes: Int
    /// Milliseconds.
    let askedAt: Double
    /// waiting · lapsed · denied · allowed · over · ended
    let state: String
    let answerBy: Double
    let until: Double?
}

/// `GET /api/pairings`: a device asking to join, with the code it shows.
/// `GET /api/about-you`: a fact about you, as a memory of the mind. Yours (`owner`) goes with every answer of his; his
/// (an agent's) is only proposed, and waits for you to keep it.
struct Fact: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let text: String
    let trust: String
}

/// What he knows of you: what you kept, and what he proposed.
struct AboutYou: Decodable, Sendable {
    let kept: [Fact]
    let proposed: [Fact]
}

struct PairingView: Decodable, Sendable, Identifiable, Equatable {
    let invite: String
    let device: String
    let name: String
    let kind: String
    let sas: String
    let requestedAt: Double
    let conflict: Bool
    var id: String { "\(invite):\(device)" }
}

/// `GET /api/turns`: what the node is answering now.
struct TurnView: Decodable, Sendable, Equatable {
    let id: String
    let conversation: String?
    let title: String?
    let step: String?
    /// Whether this device may watch it (false: it read the bank, and this device may not). Absent from an older node.
    let watchable: Bool?
}

/// `GET /api/quests`: a quest in hand.
struct QuestView: Decodable, Sendable, Equatable {
    let goal: String
}

/// The millisecond time an HLC (`<15-digit ms>.<6-digit counter>`) was taken at, or nil.
func hlcDate(_ hlc: String) -> Date? {
    guard let ms = Double(hlc.split(separator: ".").first ?? ""), ms > 0 else { return nil }
    return Date(timeIntervalSince1970: ms / 1000)
}
