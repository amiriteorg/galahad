import Foundation

/*
 * Galahad's orb, as data (the PWA's lib/orb.ts, held to it by the vectors; your word, 23 November 2026: he is the one
 * you talk to, "a Jarvis … like visual, the orb graphic"): a sphere of light inside the rings of a heads-up display, in
 * the colour of his state. The parts it is drawn from, in a square 200 wide centred on its middle (y down), and each
 * state's colours; GalahadOrb draws them. How they move in each of his moods is OrbMotion.swift's (your word, 24
 * November 2026); still, they are these parts as they stand.
 */
enum Orb {
    /// His line's tone (GalahadNow.Tone), and red for a failure.
    enum Tone: String, CaseIterable, Sendable { case neutral, accent, warn, ok, danger }
    /// How much of him a size can show: a badge (beside his words), a seat (at the Roundtable), or all of him (his welcome).
    enum Level: String, Sendable { case badge, seat, full }
    /// What a part is coloured with: one of its palette's colours, or white.
    enum Ink: String, Sendable { case tint, light, deep, white }

    /// A state's colours: its tint, the tint lit (45 % of it, with white) and in shadow (52 %, with black), mixed in OKLab.
    struct Palette: Equatable, Sendable {
        let tint: String
        let light: String
        let deep: String
    }

    /// A gradient's stop: how far along it (0 to 1), its colour, and how opaque.
    struct Stop: Equatable, Sendable {
        let at: Double
        let ink: Ink
        let opacity: Double
    }

    /// A point of the square, from its middle (y down).
    struct Point: Equatable, Sendable {
        let x: Double
        let y: Double
    }

    /// An arc of a ring, in degrees clockwise from the top.
    struct Arc: Equatable, Sendable {
        let from: Double
        let to: Double
    }

    /// A part, drawn in order, each over those before it; its name is the PWA's (its SVG class).
    struct Part: Equatable, Sendable {
        let name: String
        let kind: Kind
    }

    enum Kind: Equatable, Sendable {
        /// A circle filled by a radial gradient, lit from (cx, cy) as fractions of its box, reaching `spread` of its width.
        case disc(r: Double, cx: Double, cy: Double, spread: Double, stops: [Stop])
        /// A circle's stroke, whole (no arcs) or only its arcs.
        case ring(r: Double, width: Double, ink: Ink, opacity: Double, arcs: [Arc]?)
        /// `count` short strokes across a circle, evenly round from `offset` degrees, each `length` long and `width` wide.
        case ticks(r: Double, count: Int, offset: Double, length: Double, width: Double, ink: Ink, opacity: Double)
        /// A circle's stroke lit along the line from `from` to `to` (a linear gradient).
        case rim(r: Double, width: Double, from: Point, to: Point, stops: [Stop])
        /// An ellipse of white, turned by `rotate` degrees about its middle.
        case shine(cx: Double, cy: Double, rx: Double, ry: Double, rotate: Double, opacity: Double)
    }

    /// From these sizes (points), a seat's rings and then the full display's ticks can be told apart.
    static let seatFrom: Double = 48
    static let fullFrom: Double = 120

    static func level(_ size: Double) -> Level { size >= fullFrom ? .full : size >= seatFrom ? .seat : .badge }

    /// The parts of an orb this size, in the order they're drawn.
    static func parts(_ size: Double) -> [Part] {
        switch level(size) {
        case .badge: badge
        case .seat: seat
        case .full: full
        }
    }

    static func palette(_ tone: Tone) -> Palette { palettes[tone]! }

    /// Each state's light: a calm blue at rest, a brighter blue at work, amber when something waits on you, green for an
    /// answer new to you, red for a failure. The bright tints in both themes.
    static let palettes: [Tone: Palette] = [
        .neutral: Palette(tint: "#8ab8ff", light: "#cae0ff", deep: "#354969"),
        .accent: Palette(tint: "#58a6ff", light: "#b6d8ff", deep: "#1f4169"),
        .warn: Palette(tint: "#f0b549", light: "#f9dfb4", deep: "#624818"),
        .ok: Palette(tint: "#4cc38a", light: "#b6e5c9", deep: "#1a4e35"),
        .danger: Palette(tint: "#ff6b6b", light: "#ffc0bb", deep: "#692727"),
    ]

    // ---- the parts (lib/orb.ts' PARTS) ----

    /// The four gaps of the outer ring, at the top, the sides and the foot, where its notches stand.
    private static func quarters(_ gap: Double) -> [Arc] { [0.0, 90, 180, 270].map { Arc(from: $0 + gap, to: $0 + 90 - gap) } }
    /// Three arcs a third of the way round from each other: the display's segments.
    private static let thirds = [Arc(from: 20, to: 90), Arc(from: 140, to: 210), Arc(from: 260, to: 330)]

    private static let halo = Part(name: "halo", kind: .disc(r: 99, cx: 0.5, cy: 0.5, spread: 0.5, stops: [Stop(at: 0, ink: .tint, opacity: 0.55), Stop(at: 0.62, ink: .tint, opacity: 0.2), Stop(at: 1, ink: .tint, opacity: 0)]))
    private static func body(_ r: Double) -> Part {
        Part(name: "body", kind: .disc(r: r, cx: 0.4, cy: 0.36, spread: 0.72, stops: [Stop(at: 0, ink: .white, opacity: 0.96), Stop(at: 0.24, ink: .light, opacity: 1), Stop(at: 0.64, ink: .tint, opacity: 1), Stop(at: 1, ink: .deep, opacity: 1)]))
    }
    /// Light through the glass, gathered at its lower edge as a marble's is.
    private static func rim(_ r: Double, _ width: Double, _ reach: Double) -> Part {
        Part(name: "rim", kind: .rim(r: r, width: width, from: Point(x: -reach, y: -reach), to: Point(x: reach, y: reach), stops: [Stop(at: 0, ink: .white, opacity: 0), Stop(at: 0.55, ink: .white, opacity: 0), Stop(at: 1, ink: .white, opacity: 0.55)]))
    }
    private static func core(_ r: Double) -> Part { Part(name: "core", kind: .disc(r: r, cx: 0.5, cy: 0.5, spread: 0.5, stops: [Stop(at: 0, ink: .white, opacity: 0.85), Stop(at: 1, ink: .white, opacity: 0)])) }
    private static func shine(_ cx: Double, _ cy: Double, _ rx: Double, _ ry: Double) -> Part { Part(name: "shine", kind: .shine(cx: cx, cy: cy, rx: rx, ry: ry, rotate: -28, opacity: 0.3)) }

    private static let full: [Part] = [
        halo,
        Part(name: "ring", kind: .ring(r: 95, width: 1.1, ink: .tint, opacity: 0.5, arcs: quarters(6))),
        Part(name: "notches", kind: .ticks(r: 95, count: 4, offset: 0, length: 9, width: 1.6, ink: .tint, opacity: 0.8)),
        Part(name: "ticks", kind: .ticks(r: 86.5, count: 72, offset: 0, length: 3, width: 0.8, ink: .tint, opacity: 0.45)),
        Part(name: "marks", kind: .ticks(r: 86.5, count: 12, offset: 0, length: 7, width: 1.4, ink: .tint, opacity: 0.75)),
        Part(name: "segments", kind: .ring(r: 77, width: 2.6, ink: .tint, opacity: 0.55, arcs: thirds)),
        Part(name: "inner", kind: .ring(r: 70.5, width: 0.8, ink: .tint, opacity: 0.28, arcs: nil)),
        body(60),
        rim(58.6, 1.8, 41),
        core(26),
        shine(-21, -27, 19, 10),
        Part(name: "glint", kind: .shine(cx: -31, cy: -35, rx: 3.4, ry: 2.6, rotate: -28, opacity: 0.8)),
    ]

    private static let seat: [Part] = [
        halo,
        Part(name: "ring", kind: .ring(r: 94, width: 2.4, ink: .tint, opacity: 0.55, arcs: quarters(8))),
        Part(name: "notches", kind: .ticks(r: 94, count: 4, offset: 0, length: 12, width: 3.2, ink: .tint, opacity: 0.85)),
        Part(name: "segments", kind: .ring(r: 80, width: 4.5, ink: .tint, opacity: 0.5, arcs: thirds)),
        body(66),
        rim(64.4, 2.6, 45),
        core(28),
        shine(-23, -30, 21, 11),
    ]

    private static let badge: [Part] = [
        Part(name: "ring", kind: .ring(r: 94, width: 5, ink: .tint, opacity: 0.5, arcs: nil)),
        body(78),
        rim(76, 3.5, 53),
        core(30),
        shine(-27, -34, 24, 13),
    ]
}

extension Orb.Tone {
    /// His line's tone, as the orb shows it.
    init(_ tone: GalahadNow.Tone) { self = Orb.Tone(rawValue: tone.rawValue) ?? .neutral }

    /// Where he stands at the Roundtable, as his ring there would show it: blue at work, amber when he needs you, red when
    /// his work failed, green for what's new to you, his calm blue otherwise.
    init(_ standing: Standing) {
        switch standing {
        case .working: self = .accent
        case .needs: self = .warn
        case .failed: self = .danger
        case .verified, .unread: self = .ok
        case .paused, .queued, .resting: self = .neutral
        }
    }
}
