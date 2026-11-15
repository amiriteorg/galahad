import Foundation

/*
 * The Roundtable, as the PWA's roster says it (apps/web/src/lib/roster.ts): Galahad first (his line is lib/now.ts), then
 * each knight, every row one line of latest activity and a mark when it needs you. Worked out from what the app already
 * asks the node: the team as one snapshot and the approvals waiting. Nothing is asked for per row. (The PWA also shows
 * the last thing said in a conversation it has read; this app reads no conversation yet, so that line never comes.)
 */

/// An approval waiting for your answer: who asked, and for what.
struct Ask: Decodable, Sendable, Equatable {
    let by: String
    let connector: String?
    let tool: String?
}

struct RosterRow: Sendable, Equatable, Identifiable {
    /// The knight's handle.
    let id: String
    let name: String
    /// Its own conversation with you, when it has one.
    let room: String?
    let line: String
    /// Only you can move this on: a failure to read, an approval to give, work waiting on a pause.
    let needs: Bool
    /// What its face shows (KnightEyes): asking when it asks your leave or your approval, else what it is doing.
    var expression = "idle"
}

/// A room of the Roundtable: its knights' conversation together, and one line of where it stands (lib/roster.ts' room row).
struct RoomRow: Sendable, Equatable, Identifiable {
    let id: String
    let name: String
    let members: [String]
    let line: String
    let needs: Bool
}

enum Roster {
    /// The knight that filed an approval (`arm:team.<controller>.<handle>`), or nil when someone else asked.
    static func knightOfCaller(_ by: String) -> String? {
        by.wholeMatch(of: #/arm:team\.[a-f0-9]{10}\.([a-z][a-z0-9-]{0,31})/#).map { String($0.1) }
    }

    /// What waits for you that is no knight's: the Inbox's count, less the approvals that show on a knight's own row.
    static func galahadNeeds(inbox: Int, asks: [Ask], knights: [String]) -> Int {
        max(0, inbox - asks.filter { knights.contains(knightOfCaller($0.by) ?? "") }.count)
    }

    /// Every knight, as the node lists them. `now`: what "just now" is, in milliseconds, for a face that has just been pleased or concerned.
    static func rows(snapshot: TeamSnapshot, asks: [Ask], now: Double = Date.now.timeIntervalSince1970 * 1000) -> [RosterRow] {
        snapshot.teammates.map { row(for: $0, in: snapshot, asks: asks, now: now) }
    }

    /// Every room that isn't a knight's own conversation with you, the latest spoken in first.
    static func roomRows(snapshot: TeamSnapshot) -> [RoomRow] {
        snapshot.rooms.filter { !$0.direct }.enumerated().sorted { a, b in
            a.element.updatedAt != b.element.updatedAt ? a.element.updatedAt > b.element.updatedAt : a.offset < b.offset
        }.map { roomRow(for: $0.element, in: snapshot) }
    }

    private static func roomRow(for room: TeamRoom, in snapshot: TeamSnapshot) -> RoomRow {
        let nameOf = { (id: String) in snapshot.teammates.first { $0.id == id }?.name ?? id }
        let jobs = snapshot.tasks.filter { $0.room == room.id }.map(Job.task) + snapshot.deliveries.filter { $0.room == room.id }.map(Job.delivery)
        let say = { (line: String, needs: Bool) in RoomRow(id: room.id, name: room.name, members: room.members, line: line, needs: needs) }

        if let line = proposing(jobs, by: nameOf) { return say(line, true) }

        let working = jobs.compactMap { $0.status == "running" ? $0.task : nil }
        if let first = working.first { return say("\(working.count > 1 ? "\(working.count) at work" : nameOf(first.assignee)) · \(first.title)", false) }
        let writing = jobs.compactMap { job -> TeamDelivery? in if case .delivery(let d) = job, d.status == "running" { d } else { nil } }
        if !writing.isEmpty { return say("\(writing.map { nameOf($0.teammate) }.joined(separator: ", ")) \(writing.count > 1 ? "are" : "is") writing", false) }
        let last = latest(of: jobs)
        if let wrong = trouble(last, who: last.flatMap { job in if case .delivery(let d) = job { nameOf(d.teammate) } else { nil } }) { return say(wrong, true) }
        let waiting = jobs.filter { $0.status == "queued" }.count
        if room.paused { return say(waiting > 0 ? "Paused · \(waiting) waiting" : "Paused", waiting > 0) }
        return say(room.members.map(nameOf).joined(separator: ", "), false)
    }

    private enum Job {
        case task(TeamTask)
        case delivery(TeamDelivery)

        var status: String { switch self { case .task(let t): t.status; case .delivery(let d): d.status } }
        var updatedAt: Double { switch self { case .task(let t): t.updatedAt; case .delivery(let d): d.updatedAt } }
        var error: String? { switch self { case .task(let t): t.error; case .delivery(let d): d.error } }
        var task: TeamTask? { if case .task(let t) = self { t } else { nil } }
    }

    private static func row(for person: Teammate, in snapshot: TeamSnapshot, asks: [Ask], now: Double) -> RosterRow {
        let room = snapshot.rooms.first { $0.direct && $0.members == [person.id] }
        let jobs = snapshot.tasks.filter { $0.assignee == person.id }.map(Job.task) + snapshot.deliveries.filter { $0.teammate == person.id }.map(Job.delivery)
        let asked = asks.filter { knightOfCaller($0.by) == person.id }
        // Its face says what its line says: asking your leave or your approval, over whatever else it has in hand.
        let asking = !asked.isEmpty || jobs.contains { $0.status == "proposed" && $0.task != nil }
        let expression = asking ? "asking" : KnightEyes.expression(of: person, in: snapshot, now: now)
        let say = { (line: String, needs: Bool) in RosterRow(id: person.id, name: person.name, room: room?.id, line: line, needs: needs, expression: expression) }

        // What only you can answer comes first: it is what the row is marked for.
        if let ask = asked.first {
            return say("Asks your leave: \(ask.connector ?? "").\(ask.tool ?? "")\(asked.count > 1 ? ", and \(asked.count - 1) more" : "")", true)
        }
        if let line = proposing(jobs, by: { id in id == person.id ? nil : snapshot.teammates.first { $0.id == id }?.name ?? id }) { return say(line, true) }
        if let running = jobs.first(where: { $0.status == "running" && $0.task != nil })?.task {
            let progress = firstLine(running.progress)
            return say(progress.isEmpty ? "Working on \(titled(running))" : "\(running.title) · \(progress)", false)
        }
        if jobs.contains(where: { $0.status == "running" }) { return say("Writing a reply", false) }
        if let wrong = trouble(latest(of: jobs)) { return say(wrong, true) }
        let waiting = jobs.filter { $0.status == "queued" }.count
        let held = !person.enabled ? "Paused" : person.turnsToday >= person.dailyTurns ? "Daily allowance spent" : nil
        if let held { return say(waiting > 0 ? "\(held) · \(waiting) waiting" : held, waiting > 0) }
        if let queued = jobs.first(where: { $0.status == "queued" && $0.task != nil })?.task {
            let blocking = dependencies(of: queued, in: snapshot.tasks).first { !$0.satisfied }
            return say(blocking.map { "Waiting for “\($0.title)”" } ?? "Queued: \(titled(queued))", false)
        }
        if waiting > 0 { return say("Reply queued", false) }
        if let task = latest(of: jobs.filter { $0.task != nil })?.task { return say(ended(task), false) }
        let job = firstLine(person.instructions).isEmpty ? person.role : firstLine(person.instructions)
        return say(maker(of: person, in: snapshot).map { "Made by \($0) · \(job)" } ?? job, false)
    }

    /// The first line of a text, trimmed (the PWA's `firstLine`).
    static func firstLine(_ text: String?) -> String {
        let first = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").first ?? ""
        return first.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func titled(_ task: TeamTask) -> String { "“\(task.title)”" }

    private static func withWhy(_ line: String, _ why: String?) -> String {
        firstLine(why).isEmpty ? line : "\(line) · \(firstLine(why))"
    }

    /// The latest by when it last moved; of two at once, the first.
    private static func latest(of jobs: [Job]) -> Job? {
        jobs.reduce(nil) { latest, job in latest.map { job.updatedAt > $0.updatedAt ? job : $0 } ?? job }
    }

    /// Work that went wrong and waits to be read, in a line (nil: it didn't, or it was a stop of your own). `who`: in a
    /// room, the knight whose reply it was.
    private static func trouble(_ job: Job?, who: String? = nil) -> String? {
        guard let job, job.status == "failed" || job.status == "interrupted" else { return nil }
        if job.status == "interrupted" { return "Interrupted: \(job.task.map(titled) ?? (who.map { "\($0)'s reply" } ?? "a reply")) · review it before resuming" }
        return job.task.map { withWhy("Failed: \(titled($0))", job.error) } ?? withWhy(who.map { "\($0) couldn't reply" } ?? "Couldn't reply", job.error)
    }

    /// What waits for your approval, in a line: who proposes the latest (`by` names them, nil: the row's own knight), and
    /// how many more there are (lib/roster.ts' `proposing`). Nil: nothing waits.
    private static func proposing(_ jobs: [Job], by: (String) -> String?) -> String? {
        let proposed = jobs.compactMap { $0.status == "proposed" ? $0.task : nil }.enumerated().sorted { a, b in
            a.element.updatedAt != b.element.updatedAt ? a.element.updatedAt > b.element.updatedAt : a.offset < b.offset
        }.map(\.element)
        guard let latest = proposed.first else { return nil }
        let who = latest.proposedBy.flatMap(by)
        return "\(who.map { "\($0) proposes" } ?? "Proposes") \(titled(latest))\(proposed.count > 1 ? ", and \(proposed.count - 1) more" : "")"
    }

    /// How a task ended, when that is the latest thing to say.
    private static func ended(_ task: TeamTask) -> String {
        if task.status == "stopped" { return "Stopped: \(titled(task))" }
        let kept = task.changes.map { " · \($0.files) file\($0.files == 1 ? "" : "s") kept" } ?? ""
        return "\(task.verified ? "Verified" : "Done"): \(titled(task))\(kept)"
    }

    /// A queued task can't run until every task before it completed and passed its checks.
    private static func dependencies(of task: TeamTask, in all: [TeamTask]) -> [(title: String, satisfied: Bool)] {
        task.dependsOn.map { id in
            let parent = all.first { $0.id == id }
            return (parent?.title ?? id, parent?.status == "done" && parent?.verified == true)
        }
    }

    /// Who made a knight, when that wasn't you: Galahad, or the knight that did.
    private static func maker(of person: Teammate, in snapshot: TeamSnapshot) -> String? {
        guard let by = person.createdBy, by != "owner" else { return nil }
        if by == "galahad" { return "Galahad" }
        return snapshot.teammates.first { $0.id == by }?.name ?? snapshot.removed?.first { $0.id == by }?.name ?? by
    }
}

/// What Galahad is doing, for his own row: what this app watches him write, the turns the node runs, the quests in
/// hand, and what waits for you (nil: not asked yet, so nothing is said of it).
struct GalahadWork: Decodable, Sendable, Equatable {
    /// He is answering on this screen, at `step` (nil: only just started).
    var answering = false
    var step: String?
    /// The titles of the turns the node is running (nil: a temporary chat).
    var turns: [String?] = []
    var quests: [String] = []
    var needs: Int?

    init(answering: Bool = false, step: String? = nil, turns: [String?] = [], quests: [String] = [], needs: Int? = nil) {
        (self.answering, self.step, self.turns, self.quests, self.needs) = (answering, step, turns, quests, needs)
    }

    // As lib/now.ts's NowInput: `step` absent is "not answering here", and null is "only just started".
    private enum Keys: String, CodingKey { case step, turns, quests, needs }
    private struct Turn: Decodable { let title: String? }
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        answering = container.contains(.step)
        step = try container.decodeIfPresent(String.self, forKey: .step)
        turns = try container.decode([Turn].self, forKey: .turns).map(\.title)
        quests = try container.decode([QuestView].self, forKey: .quests).map(\.goal)
        needs = try container.decodeIfPresent(Int.self, forKey: .needs)
    }
}

/// His line (lib/now.ts's `galahadNow`): the work first, then what needs you.
struct GalahadNow: Equatable, Sendable {
    enum Tone: String, Sendable { case neutral, accent, warn }
    let text: String
    let tone: Tone

    /// How much waits for you, as it's said everywhere.
    static func needsYou(_ n: Int) -> String { "\(n) \(n == 1 ? "thing needs" : "things need") you" }

    init(_ work: GalahadWork) {
        let inHand = work.turns.count + work.quests.count
        let needs = (work.needs ?? 0) > 0 ? Self.needsYou(work.needs!) : nil
        var doing: String?
        if work.answering {
            doing = (work.step?.isEmpty == false ? work.step : nil) ?? "Starting"
        } else if inHand > 1 {
            doing = "Working on \(inHand) things"
        } else if let turn = work.turns.first {
            doing = turn.flatMap { $0.isEmpty ? nil : "Working in “\($0)”" } ?? "Working in a temporary chat"
        } else if let quest = work.quests.first {
            doing = "Working on: \(quest.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")[0])"
        }
        text = doing.map { [$0, needs].compactMap { $0 }.joined(separator: " · ") } ?? needs ?? (work.needs == 0 ? "Idle · nothing needs you" : "Idle")
        tone = needs != nil ? .warn : doing != nil ? .accent : .neutral
    }
}

/**
 * Which of the owner's ten drawings a knight wears (core's `avatarLook`): a look chosen for it (its saved profile has one
 * of the drawings' colours) is the one; else the drawing its first name is (a knight called Gareth is drawn as Gareth);
 * else, for an older profile, the drawing nearest its colour; else one of the ten from its handle alone, the same on
 * every device. Galahad's own drawing is his alone.
 */
enum AvatarLook {
    static let looks: [(id: String, color: String)] = [
        ("kay", "#f9e9d9"), ("gaheris", "#9c494f"), ("percival", "#d5adc7"), ("palamedes", "#945764"), ("gawain", "#84845e"),
        ("tristan", "#999aab"), ("lancelot", "#93a2c0"), ("bedivere", "#9dac9e"), ("bors", "#be7153"), ("gareth", "#fbc866"),
    ]

    static func of(id: String, name: String, profile: JSONValue?) -> String {
        let saved = savedColor(profile)
        if let chosen = looks.first(where: { $0.color == saved }) { return chosen.id }
        let first = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        if let named = looks.first(where: { $0.id == first }) { return named.id }
        if let saved { return looks.dropFirst().reduce(looks[0]) { apart($1.color, saved) < apart($0.color, saved) ? $1 : $0 }.id }
        var seed: UInt32 = 2_166_136_261
        for unit in id.utf16 { seed = (seed ^ UInt32(unit)) &* 16_777_619 }
        return looks[Int(seed % UInt32(looks.count))].id
    }

    /// A saved profile's colour (lowercased) when it is exactly a profile's seven fields, each valid (core's
    /// `isAvatarProfile`); anything else is old or malformed, and names no colour.
    static func savedColor(_ profile: JSONValue?) -> String? {
        guard case .object(let p)? = profile, Set(p.keys) == ["v", "form", "color", "accent", "eyes", "accessory", "temperament"],
              p["v"] == .number(1), case .string(let color)? = p["color"], case .string(let accent)? = p["accent"], isHex(color), isHex(accent),
              oneOf(p["form"], ["round", "armored", "hooded"]), oneOf(p["eyes"], ["oval", "round", "visor"]),
              oneOf(p["accessory"], ["none", "plume", "ears", "crown"]), oneOf(p["temperament"], ["calm", "curious", "lively"]) else { return nil }
        return color.lowercased()
    }

    private static func isHex(_ text: String) -> Bool { text.wholeMatch(of: #/#[0-9a-fA-F]{6}/#) != nil }

    private static func oneOf(_ value: JSONValue?, _ allowed: [String]) -> Bool {
        if case .string(let text)? = value { allowed.contains(text) } else { false }
    }

    /// How far apart two colours look: RGB weighted by how much red there is ("redmean"), plenty for a nearest.
    private static func apart(_ a: String, _ b: String) -> Double {
        let channels = { (hex: String) in [1, 3, 5].map { Double(Int(hex.dropFirst($0).prefix(2), radix: 16) ?? 0) } }
        let (x, y) = (channels(a), channels(b))
        let red = (x[0] + y[0]) / 2
        return ((2 + red / 256) * pow(x[0] - y[0], 2) + 4 * pow(x[1] - y[1], 2) + (2 + (255 - red) / 256) * pow(x[2] - y[2], 2)).squareRoot()
    }
}
