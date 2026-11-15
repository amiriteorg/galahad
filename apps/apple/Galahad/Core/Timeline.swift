import Foundation

/// A word said in a room of the Roundtable (core's `TeamMessage`).
struct TeamMessage: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let room: String
    /// owner (you), galahad, system, or a knight's id.
    let speaker: String
    let speakerName: String
    let text: String
    let createdAt: Double
}

/// `POST /api/team/room`: a room with its words, its work and the replies on their way.
struct TeamRoomView: Decodable, Sendable {
    let id: String
    let name: String
    let members: [String]
    let direct: Bool
    let paused: Bool
    let messages: [TeamMessage]
    let tasks: [TeamTask]
    let deliveries: [TeamDelivery]
}

/**
 * A knight is one timeline: what was said and the tasks it was given, in the order they happened (the PWA's
 * lib/timeline.ts). A task sits where it was given and stays there while it runs and after it ends, so nothing in the
 * timeline moves under you. What a task's card says comes from lib/task-card.ts, and who said what from lib/team.ts.
 */
enum Timeline {
    enum Item: Identifiable, Sendable {
        case message(TeamMessage)
        case task(TeamTask)

        var id: String {
            switch self {
            case .message(let message): message.id
            case .task(let task): "task:\(task.id)"
            }
        }

        var at: Double {
            switch self {
            case .message(let message): message.createdAt
            case .task(let task): task.createdAt ?? task.updatedAt
            }
        }
    }

    /// `since`: where the words begin, when the node sent only the latest of them. Tasks that ended before it are left
    /// out with the words they went with; work still in hand is always there.
    static func items(messages: [TeamMessage], tasks: [TeamTask], since: Double? = nil) -> [Item] {
        var shown = tasks
        if let since {
            shown = tasks.filter { task in (task.createdAt ?? 0) >= since || task.status == "queued" || task.status == "running" }
        }
        // The node lists tasks latest first: turned round, two given at the same moment keep the order they were given in.
        let all: [Item] = messages.map { Item.message($0) } + shown.reversed().map { Item.task($0) }
        // A stable sort: at the same moment, the words come before the work they asked for.
        let placed = all.enumerated().sorted { a, b in a.element.at != b.element.at ? a.element.at < b.element.at : a.offset < b.offset }
        return placed.map { $0.element }
    }

    /// The tasks a conversation's timeline holds: for a knight's own, every task given to it, wherever; for a room, the room's.
    static func tasks(room: (id: String, direct: Bool, members: [String]), all: [TeamTask]) -> [TeamTask] {
        let knight = room.direct && room.members.count == 1 ? room.members[0] : nil
        return all.filter { task in
            if let knight { return task.assignee == knight }
            return task.room == room.id
        }
    }

    /// Who said it, as the timeline names them.
    static func speaker(_ message: TeamMessage, teammates: [Teammate]) -> String {
        switch message.speaker {
        case "owner": return "You"
        case "galahad": return "Galahad"
        case "system": return "The Roundtable"
        default:
            if !message.speakerName.isEmpty { return message.speakerName }
            return teammates.first { $0.id == message.speaker }?.name ?? message.speaker
        }
    }
}

/// What a task's card says, in words (lib/task-card.ts): where it stands, how it ended and why, what the knight said of
/// it, what can be done with it, who gave it to the Roundtable, and what it kept.
enum TaskCard {
    enum Tone: String, Sendable { case ok, warn, danger, accent, neutral }
    enum Action: String, Sendable { case stop, resume, again }

    /// Where it stands, toned as status is everywhere: green only for verified work.
    static func badge(_ task: TeamTask) -> (text: String, tone: Tone) {
        switch task.status {
        case "queued": ("Queued", .neutral)
        case "running": ("Running", .accent)
        case "done": task.verified ? ("Verified", .ok) : ("Not verified", .warn)
        case "failed": ("Failed", .danger)
        case "stopped": ("Stopped", .neutral)
        case "interrupted": ("Interrupted", .warn)
        default: (task.status, .neutral)
        }
    }

    private static let questEnds = [
        "gave-up": "It gave up.",
        "unverified": "Not verified: its gates or the independent review did not pass.",
        "stopped": "It stopped before the work was done.",
    ]
    private static let unsaid = ["failed": "It failed without saying why.", "stopped": "Stopped.", "interrupted": "Interrupted. Review it before resuming.", "done": "The work was not independently verified."]
    /// As much of what the knight said as a card shows.
    private static let saidLength = 1000

    /// How it ended: why it wasn't verified (nil: it was), and what the knight said of it. Nil for work still in hand.
    static func end(_ task: TeamTask) -> (why: String?, said: String?)? {
        if task.status == "queued" || task.status == "running" { return nil }
        let output = task.output ?? ""
        let summary = Markdown.trim(output.components(separatedBy: "\n\nReview:")[0])
        let units = Array(summary.utf16)
        let said: String? = summary.isEmpty || summary.hasPrefix("Review:") ? nil
            : units.count > saidLength ? String(decoding: units.prefix(saidLength - 1), as: UTF16.self) + "…" : summary
        if task.status == "done", task.verified { return (nil, said) }
        let error = task.error.map(Markdown.trim) ?? ""
        let why = error.isEmpty ? unsaid[task.status] : (questEnds[error] ?? error)
        return (why, said)
    }

    /// Work in hand stopped; work that ended unverified resumed or given again.
    static func actions(_ task: TeamTask) -> [Action] {
        if task.status == "queued" || task.status == "running" { return [.stop] }
        if task.status == "done" { return task.verified ? [] : [.again] }
        return [.resume, .again]
    }

    /// Who gave it to the Roundtable rather than to a knight by name (nil: it was given by name).
    static func given(_ task: TeamTask) -> String? {
        switch task.givenBy {
        case "owner": "Given to the Roundtable by you"
        case "galahad": "Given to the Roundtable by Galahad"
        default: nil
        }
    }

    /// What it kept of its changes (nil: nothing kept).
    static func kept(_ task: TeamTask) -> String? {
        task.changes.map { "\($0.files) file\($0.files == 1 ? "" : "s") changed" }
    }
}
