import Foundation

/// What is under way in a chat (core's `UnderwayView`, the PWA's lib/underway.ts): the tasks he gave knights from it that
/// haven't ended, and the looks he set himself there that wait.
struct UnderwayView: Decodable, Sendable, Equatable {
    struct Task: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let title: String
        /// The knight's handle, and its name.
        let assignee: String
        let name: String
        /// queued · running
        let status: String
        let progress: String
        /// The knight's own conversation with you, where it works.
        let room: String
    }

    struct Look: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        /// When he looks again (ms since 1970).
        let at: Double
        let note: String
    }

    let tasks: [Task]
    let looks: [Look]

    static let none = UnderwayView(tasks: [], looks: [])
    var isEmpty: Bool { tasks.isEmpty && looks.isEmpty }
}

/// What is under way, in words: the PWA's lib/underway.ts, word for word.
enum UnderwayWords {
    /// A time as the row says it: "23:07" today, "Wed 25 Nov, 09:00" on another day.
    static func when(_ at: Date, now: Date = .now, zone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let time = format("HH:mm", zone).string(from: at)
        if calendar.isDate(at, inSameDayAs: now) { return time }
        return "\(format("EEE d MMM", zone).string(from: at)), \(time)"
    }

    private static func format(_ pattern: String, _ zone: TimeZone) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = zone
        f.dateFormat = pattern
        return f
    }

    /// A task's line: its knight, how it stands (its first line of progress, or at work; waiting its turn while queued).
    static func state(of task: UnderwayView.Task) -> String {
        if task.status == "queued" { return "waiting its turn" }
        let first = task.progress.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        return first.isEmpty ? "at work" : String(first.prefix(80))
    }

    /// A look's line: when he looks again, and what at.
    static func look(_ look: UnderwayView.Look, now: Date = .now, zone: TimeZone = .current) -> String {
        "Looking again at \(when(Date(timeIntervalSince1970: look.at / 1000), now: now, zone: zone)): \(look.note)"
    }

    /// A look of his come back, as the chat shows its message: when he said he would, and what at.
    static func looked(_ look: StoredMessage.Look, now: Date = .now, zone: TimeZone = .current) -> String {
        "He looked again, as he said at \(when(Date(timeIntervalSince1970: look.set / 1000), now: now, zone: zone)) he would: \(look.note)"
    }
}
