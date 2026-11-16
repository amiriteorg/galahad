import CoreGraphics
import Foundation

/*
 * A knight's live eyes, as the PWA draws them (apps/web/src/lib/knight-eyes.ts and ui/avatar.ts): where each drawing's
 * eyes are, how each state shows them, which state a knight is in (core's avatarExpression), and how they move with
 * time. The drawing is never drawn again: only its two eyes are covered in the slit's own dark and drawn anew.
 */

enum KnightEyes {
    /// An eye on the drawing's 768-unit canvas: its centre, its radius, and the dark of the slit round it.
    struct Eye: Sendable, Equatable {
        let x: Double
        let y: Double
        let r: Double
        let slit: String
    }

    enum Shape: String, Sendable { case open, wide, low, happy, shut, ember }

    /// The canvas every drawing is on, in the units its eyes are given in.
    static let canvas = 768.0

    /// Where each drawing's eyes are (lib/knight-eyes.ts' ART).
    static let art: [String: [Eye]] = [
        "galahad": [Eye(x: 281, y: 293, r: 13.7, slit: "#342015"), Eye(x: 483, y: 294, r: 13.6, slit: "#331e13")],
        "black-knight": [Eye(x: 230, y: 282, r: 12.8, slit: "#271b12"), Eye(x: 428, y: 282, r: 13.6, slit: "#251a11")],
        "kay": [Eye(x: 271, y: 304, r: 12.8, slit: "#24170c"), Eye(x: 444, y: 304, r: 12.8, slit: "#25170c")],
        "gaheris": [Eye(x: 278, y: 291, r: 13.7, slit: "#2a1e17"), Eye(x: 484, y: 290, r: 13.7, slit: "#2b1e17")],
        "percival": [Eye(x: 222, y: 303, r: 12.3, slit: "#33261d"), Eye(x: 360, y: 300, r: 12.9, slit: "#2a1f17")],
        "palamedes": [Eye(x: 300, y: 325, r: 10.9, slit: "#2b1e15"), Eye(x: 467, y: 325, r: 11.0, slit: "#2b1e15")],
        "gawain": [Eye(x: 228, y: 377, r: 18.2, slit: "#2c2114"), Eye(x: 401, y: 377, r: 18.8, slit: "#2a1f13")],
        "tristan": [Eye(x: 243, y: 300, r: 15.3, slit: "#2a2018"), Eye(x: 415, y: 300, r: 15.4, slit: "#2a2019")],
        "lancelot": [Eye(x: 239, y: 300, r: 12.3, slit: "#231a14"), Eye(x: 375, y: 300, r: 12.4, slit: "#221913")],
        "bedivere": [Eye(x: 236, y: 295, r: 12.2, slit: "#211b12"), Eye(x: 376, y: 293, r: 12.2, slit: "#211a12")],
        "bors": [Eye(x: 296, y: 258, r: 11.9, slit: "#2b1f16"), Eye(x: 455, y: 258, r: 12.0, slit: "#291e15")],
        "gareth": [Eye(x: 236, y: 350, r: 18.6, slit: "#2f1f14"), Eye(x: 429, y: 350, r: 18.7, slit: "#2d1e13")],
    ]

    /// How each state shows: its eyes, and where they look, in eye radii, x then y (lib/knight-eyes.ts' SHOWN).
    static let shown: [String: (eyes: Shape, gaze: (x: Double, y: Double))] = [
        "idle": (.open, (0, 0)),
        "thinking": (.open, (0.4, -0.32)),
        "working": (.open, (-0.1, 0.34)),
        "reading": (.open, (0, 0.22)),
        "browsing": (.open, (0, 0.22)),
        "checking": (.open, (0, 0.28)),
        "waiting": (.open, (-0.38, -0.3)),
        "asking": (.wide, (0, 0)),
        "pleased": (.happy, (0, 0)),
        "concerned": (.low, (0, 0.3)),
        "resting": (.shut, (0, 0)),
    ]

    // MARK: Which state a knight is in

    /// What a running task's latest line shows (core's `taskStep`): planning is thinking, its desktop is browsing, a
    /// command's output is read, its gates and review are checking; any other is work.
    static func step(_ progress: String) -> String {
        let line = String(progress.drop { $0.isWhitespace })
        if line.hasPrefix("Plan · ") || line.hasPrefix("Thinking · ") { return "thinking" }
        if line.prefixMatch(of: #/Running · desktop(\s|$)/#) != nil { return "browsing" }
        if line.hasPrefix("Running · ") { return "working" }
        if line.prefixMatch(of: #/Exit -?\d+ · /#) != nil { return "reading" }
        let end = String(line.reversed().drop { $0.isWhitespace }.reversed())
        if line.prefixMatch(of: #/(Gate \d+\/\d+ · |Gates · |Gates before the work · |Review · |Submitted for review · )/#) != nil || end.wholeMatch(of: #/gate[sd]/#) != nil {
            return "checking"
        }
        return "working"
    }

    /// What a knight is doing, as its face shows it (core's `avatarExpression`): observable work, never a mood.
    static func expression(of person: Teammate, in snapshot: TeamSnapshot, now: Double) -> String {
        let tasks = snapshot.tasks.filter { $0.assignee == person.id }
        let deliveries = snapshot.deliveries.filter { $0.teammate == person.id }
        if let running = tasks.first(where: { $0.status == "running" }) { return step(running.progress) }
        if deliveries.contains(where: { $0.status == "running" }) { return "thinking" }
        if !person.enabled { return "resting" }
        let work = tasks.map { ($0.status, $0.updatedAt) } + deliveries.map { ($0.status, $0.updatedAt) }
        if tasks.contains(where: { $0.status == "proposed" }) { return "asking" }
        if work.contains(where: { $0.0 == "queued" }) { return "waiting" }
        let recent = { (at: Double) in now >= at && now - at < 30_000 }
        if work.contains(where: { ($0.0 == "failed" || $0.0 == "interrupted") && recent($0.1) }) { return "concerned" }
        if tasks.contains(where: { $0.status == "done" && $0.verified && recent($0.updatedAt) }) { return "pleased" }
        return "idle"
    }

    /// Its own moment in the blink and the glance, from its handle (0 to 4), so a roster doesn't blink as one.
    static func beat(_ id: String) -> Int {
        id.utf16.reduce(0) { ($0 * 31 + Int($1)) % 5 }
    }

    // MARK: How they move

    /// How far shut its eyes are at `t` seconds (1 open, 0.08 shut): a blink every 5.3 seconds, at its own moment.
    static func blink(at t: Double, beat: Int) -> Double {
        let delays = [0, 1.1, 2.3, 3.4, 4.2]
        let phase = ((t + delays[beat % delays.count]).truncatingRemainder(dividingBy: 5.3) + 5.3).truncatingRemainder(dividingBy: 5.3) / 5.3
        if phase < 0.93 { return 1 }
        if phase < 0.955 { return 1 - (phase - 0.93) / 0.025 * 0.92 }
        return 0.08 + (phase - 0.955) / 0.045 * 0.92
    }

    /// Where its eyes are drawn off their place at `t` seconds, in canvas units (the PWA's keyframes): glancing about
    /// at rest (unless it is calm), along the work while it runs, along the lines while it reads, after the pointer at
    /// its desktop, back and forth while its gates run, a little away while it thinks.
    static func gaze(at t: Double, expression: String, temper: String, beat: Int) -> (x: Double, y: Double) {
        let path: (period: Double, keys: [(Double, Double, Double)])
        switch expression {
        case "idle" where temper != "calm":
            path = (8.5, [(0, 0, 0), (0.56, 0, 0), (0.60, -5, -1), (0.70, -5, -1), (0.74, 5, -1), (0.84, 5, -1), (0.88, 0, 0), (1, 0, 0)])
        case "working": path = (2.8, [(0, -4, 0), (0.18, -4, 0), (0.25, -1, 0), (0.43, -1, 0), (0.5, 2, 0), (0.68, 2, 0), (0.75, 4, 1), (0.93, 4, 1), (1, -4, 0)])
        case "reading": path = (3.4, [(0, -5, -1), (0.26, 5, -1), (0.32, -5, 2), (0.58, 5, 2), (0.64, -5, 4), (0.90, 5, 4), (1, -5, -1)])
        case "browsing": path = (3, [(0, -5, 0), (0.30, 5, -1), (0.45, 5, -1), (0.70, 0, 2), (0.85, 0, 2), (1, -5, 0)])
        case "checking": path = (2.6, [(0, -5, 0), (0.5, 5, 0), (1, -5, 0)])
        case "thinking": path = (3.2, [(0, 0, 0), (0.5, -2, 1), (1, 0, 0)])
        default: return (0, 0)
        }
        let offset = [0, 1.7, 3.1, 4.9, 6.2][beat % 5]
        let phase = ((t + offset).truncatingRemainder(dividingBy: path.period) + path.period).truncatingRemainder(dividingBy: path.period) / path.period
        guard let next = path.keys.firstIndex(where: { $0.0 > phase }), next > 0 else { return (path.keys.last!.1, path.keys.last!.2) }
        let (a, b) = (path.keys[next - 1], path.keys[next])
        // Eased between keys, as a page's ease-in-out is.
        let u = (phase - a.0) / (b.0 - a.0)
        let eased = u * u * (3 - 2 * u)
        return (a.1 + (b.1 - a.1) * eased, a.2 + (b.2 - a.2) * eased)
    }

    /// Whether a state blinks: happy eyes and shut ones don't.
    static func blinks(_ expression: String) -> Bool { expression != "pleased" && expression != "resting" }

    /// From this size (in points) its eyes wander: smaller, the furthest they go is under half a point, too little to see
    /// and not worth drawing; they only blink.
    static let wandersFrom: CGFloat = 96

    /// When its eyes move, as (period, its own offset, from, to) in seconds and fractions of the period; nil: all the
    /// time (eyes that follow the work). Between these, nothing changes, and nothing need be drawn.
    static func moments(expression: String, temper: String, beat: Int, size: CGFloat = wandersFrom) -> [(period: Double, offset: Double, from: Double, to: Double)]? {
        let wanders = size >= wandersFrom
        if wanders, ["working", "reading", "browsing", "checking", "thinking"].contains(expression) { return nil }
        var moments: [(period: Double, offset: Double, from: Double, to: Double)] = []
        if blinks(expression) { moments.append((5.3, [0, 1.1, 2.3, 3.4, 4.2][beat % 5], 0.93, 1)) }
        if wanders, expression == "idle", temper != "calm" { moments.append((8.5, [0, 1.7, 3.1, 4.9, 6.2][beat % 5], 0.56, 0.88)) }
        return moments
    }

    /// The next moment from `t` at which its eyes move (nil: never); `t` itself when they are moving.
    static func nextMove(after t: Double, in moments: [(period: Double, offset: Double, from: Double, to: Double)]) -> Double? {
        moments.map { moment in
            let phase = ((t + moment.offset).truncatingRemainder(dividingBy: moment.period) + moment.period).truncatingRemainder(dividingBy: moment.period) / moment.period
            if phase >= moment.from && phase < moment.to { return t }
            let ahead = (phase < moment.from ? moment.from - phase : 1 - phase + moment.from) * moment.period
            return t + ahead
        }.min()
    }
}
