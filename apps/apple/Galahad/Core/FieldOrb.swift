import Foundation

/*
 * The orbs as fields (the PWA's lib/field-orb.ts, held to it by the vectors; 26 November 2026): Galahad's field
 * (Field.swift) is every orb, his in gold inside his heads-up ring, each knight's in its own colours. The owner's words:
 * the glyph spheres "still look a little strange/not cool enough, and almost like nipples", and "i dont want them to be
 * too visually distractin". So a field has no bright middle (its core stays dark), no regular lattice of dots, and no
 * ring round a knight; it is still where it is one of many, and moves slowly where it is the one you are looking at.
 * Pure: whose field an orb is, how it is drawn at a size, how it moves in each mood, its embers, and its ink on a light
 * page. FieldOrbView draws it.
 */

/// Whose field an orb is: its seed (its lines' longitudes and widths), its lean (Field.model's tilt), how many lines, and
/// its colours.
struct FieldIdentity: Equatable, Hashable, Sendable, Decodable {
    let seed: Int
    let tilt: [Double]
    let lines: Int
    let colours: FieldColours
}

enum FieldOrb {
    /// Galahad's: the icon's own field, in gold.
    static let galahad = FieldIdentity(seed: 11, tilt: [0.42, 0.3, -0.18], lines: 46, colours: Field.aurum)

    /// A knight's: its colours are core's knightColors (the one you chose for it, or its handle's): its key light its tint
    /// lit and its tint, its rim its second colour. Its handle gives the rest: 12 to 20 lines (fewer than his 46, so it
    /// reads at 14 points), their longitudes and widths (its seed), and its lean: its axis turned up to about 40 degrees
    /// either way in the picture, and leaning towards you by 0.25 to 0.5, so it is always seen from the side.
    static func knight(_ id: String, profile: JSONValue? = nil) -> FieldIdentity {
        let colours = KnightOrb.colors(id: id, profile: profile)
        let seed = Orb.seed(id)
        let ay = -0.5 + Orb.rand(seed, 0, 61)
        let az = -0.65 + 1.3 * Orb.rand(seed, 0, 62)
        let towards = 0.25 + 0.25 * Orb.rand(seed, 0, 60)
        // The axis (y, before the lean) ends up with z = cos(az)·sin(ax) + sin(az)·sin(ay)·cos(ax) = R·sin(ax + δ): the
        // lean about x that gives it `towards`.
        let a = cos(az), b = sin(az) * sin(ay)
        let ax = asin(towards / hypot(a, b)) - atan2(b, a)
        return FieldIdentity(
            seed: 1 + Int(seed % 2_147_483_646), tilt: [ax, ay, az], lines: 12 + Int((9 * Orb.rand(seed, 0, 63)).rounded(.down)),
            colours: FieldColours(key: [colours.light, colours.tint], rim: colours.second)
        )
    }

    /// How a field is drawn at a size (points): how many of its lines, points along each, how bold (Field.model's weight),
    /// and how far it reaches in its square (at 1 its widest point is 0.44 to 0.47 of its width from the middle).
    struct Look: Equatable, Hashable, Sendable, Decodable {
        let lines: Int
        let steps: Int
        let weight: Double
        let zoom: Double
    }

    /// A field at a size. In Galahad's ring (`ringed`) it is drawn smaller, clear of the ring, and with fewer of his lines
    /// where he is small; a knight's fills its square. The larger, the more points along a line, and the smaller, the bolder.
    static func look(_ identity: FieldIdentity, size: Double, ringed: Bool) -> Look {
        let s = size.isFinite ? max(8, size) : 36
        let lines = ringed ? min(identity.lines, s < 30 ? 26 : s < 56 ? 34 : 46) : identity.lines
        return Look(lines: lines, steps: Int(jsRound(max(20, min(96, s * 0.55)))), weight: s <= 24 ? 1.5 : s <= 48 ? 1.25 : 1, zoom: ringed ? 0.86 : 0.94)
    }

    /// Galahad's heads-up ring round his field: five arcs of ink a sixth of the way round each, with gaps between, and at
    /// the top, alone, his seat in oxblood. Angles are degrees clockwise from the top; the radius and widths are shares of
    /// the orb's width, never thinner than a pixel.
    enum Ring {
        static let r = 0.465
        static let width = 1.0 / 64
        static let arcs: [(from: Double, to: Double)] = [(38, 82), (98, 142), (158, 202), (218, 262), (278, 322)]
        static let seat = (from: -15.0, to: 15.0, width: 1.8)
        static let ink = (dark: "#e8eaf0", paper: "#181a22")
        static let inkAlpha = (dark: 0.26, paper: 0.28)
        static let oxblood = (dark: "#c8323f", paper: "#9a1f2b")
    }

    /// How wide his ring's line is, in pixels, for an orb `size` pixels wide (its seat's is `Ring.seat.width` as wide).
    static func ringWidth(_ size: Double) -> Double { max(1, size * Ring.width) }

    // MARK: How it moves

    /// A mood's motion, slow and calm (your word, 25 November 2026: "slow and calming movement"): radians a second it turns
    /// about its own axis; how bright it is (1 as at rest); a slow breath of brightness (its seconds and its depth), or
    /// none; whether a few embers drift off its rim (his alone); how far its rim has dimmed towards red-brown, 0 to 1.
    struct Motion: Equatable, Sendable {
        struct Breath: Equatable, Sendable, Decodable { let period: Double; let depth: Double }
        let turn: Double
        let glow: Double
        let breath: Breath?
        let embers: Bool
        let rim: Double
    }

    /// Galahad's moods: at rest it turns slowly; at work a little quicker, embers drifting off its rim; waiting on you it
    /// breathes; queued and paused it dims and slows (paused stops); done, it settles; failed, its rim dims to red-brown.
    static let motions: [Orb.Mood: Motion] = [
        .idle: Motion(turn: 0.1, glow: 1, breath: nil, embers: false, rim: 0),
        .working: Motion(turn: 0.2, glow: 1.08, breath: nil, embers: true, rim: 0),
        .waiting: Motion(turn: 0.08, glow: 1, breath: .init(period: 5.2, depth: 0.2), embers: false, rim: 0),
        .queued: Motion(turn: 0.06, glow: 0.85, breath: nil, embers: false, rim: 0),
        .paused: Motion(turn: 0, glow: 0.7, breath: nil, embers: false, rim: 0),
        .done: Motion(turn: 0.035, glow: 1, breath: nil, embers: false, rim: 0),
        .failed: Motion(turn: 0.03, glow: 0.88, breath: nil, embers: false, rim: 1),
    ]

    /// A mood's motion, his or a knight's. A knight's moves only while it works (your word, 26 November 2026: still in
    /// rows, moving only in its own thread's header while it works), turning as his does at work, with no embers; in every
    /// other mood it comes to rest, in that mood's light.
    static func motion(_ mood: Orb.Mood, knight: Bool) -> Motion {
        let m = motions[mood] ?? motions[.idle]!
        guard knight else { return m }
        return mood == .working ? Motion(turn: m.turn, glow: m.glow, breath: m.breath, embers: false, rim: m.rim) : Motion(turn: 0, glow: m.glow, breath: nil, embers: false, rim: m.rim)
    }

    /// Seconds a speed, a light or a tint takes to ease most of the way (63 %) to a new mood's.
    static let ease = 0.6

    /// What a field carries from one frame to the next, so a change of mood speeds or slows its turning, brightens or dims
    /// it, with no jump: radians it has turned (0 to 2π) and radians a second now; its brightness and its rim's dimming now;
    /// its breath's depth now, how far through a breath it is (0 to 1) and a breath's seconds; how much of its embers show.
    struct Clock: Equatable, Sendable, Decodable {
        var turn: Double
        var speed: Double
        var glow: Double
        var rim: Double
        var depth: Double
        var breath: Double
        var period: Double
        var embers: Double
    }

    /// A field as it is first seen: settled in its motion, at its rest (turned 0, a breath not begun).
    static func clock(_ motion: Motion) -> Clock {
        Clock(turn: 0, speed: motion.turn, glow: motion.glow, rim: motion.rim, depth: motion.breath?.depth ?? 0, breath: 0, period: motion.breath?.period ?? 6, embers: motion.embers ? 1 : 0)
    }

    /// The clock `dt` seconds on, in a motion: each speed and light eased towards the motion's, then turned on. A step longer
    /// than a frame takes (the app coming back) turns nothing a long way at once.
    static func step(_ clock: Clock, _ motion: Motion, _ dt: Double) -> Clock {
        let d = min(Orb.longestStep, max(0, dt))
        let eased = 1 - exp(-d / ease)
        func toward(_ value: Double, _ target: Double) -> Double { value + (target - value) * eased }
        let speed = toward(clock.speed, motion.turn)
        let period = motion.breath?.period ?? clock.period
        return Clock(
            turn: turned(clock.turn + speed * d), speed: speed, glow: toward(clock.glow, motion.glow), rim: toward(clock.rim, motion.rim),
            depth: toward(clock.depth, motion.breath?.depth ?? 0), breath: fract(clock.breath + d / period), period: period,
            embers: toward(clock.embers, motion.embers ? 1 : 0)
        )
    }

    /// Whether a clock has come to its motion: nothing left to ease.
    static func settled(_ clock: Clock, _ motion: Motion) -> Bool {
        func near(_ a: Double, _ b: Double, _ by: Double = 0.002) -> Bool { abs(a - b) <= by }
        return near(clock.speed, motion.turn, 0.0005) && near(clock.glow, motion.glow) && near(clock.rim, motion.rim) && near(clock.depth, motion.breath?.depth ?? 0) && near(clock.embers, motion.embers ? 1 : 0, 0.005)
    }

    /// How many frames a second a field needs now: as few as look smooth. While it eases to a mood or its embers drift,
    /// 30; breathing, 20; only turning, 15; and none once it has come to rest.
    static func fps(_ clock: Clock, _ motion: Motion) -> Double {
        if !settled(clock, motion) || clock.embers > 0.01 { return 30 }
        if clock.depth > 0.002 { return 20 }
        return clock.speed > 0.0005 ? 15 : 0
    }

    /// An ember: where it is in the orb's square (its middle 0, its edge 1; x right, y down), its radius there, and how
    /// opaque.
    struct Ember: Equatable, Sendable, Decodable {
        let x: Double
        let y: Double
        let r: Double
        let alpha: Double
    }

    /// A moment of a field: how far it is turned, how bright, how far its rim has dimmed, and its embers.
    struct Frame: Equatable, Sendable {
        let turn: Double
        let glow: Double
        let rim: Double
        let embers: [Ember]
    }

    /// His embers: how many; each lives 2.8 to 4.4 seconds (then another sets out); where they set out (a share of the way
    /// from the middle to the edge of the orb's square) and how far each drifts; how much they rise as they go; how far
    /// round from the rim's burning side they may set out (degrees either way); and their radius. Inside his ring always.
    enum Embers {
        static let count = 7
        static let life = (2.8, 4.4)
        static let from = (0.56, 0.64)
        static let drift = (0.1, 0.2)
        static let rise = 0.06
        static let spread = 70.0
        static let size = (0.016, 0.028)
    }

    /// Where the rim burns, in degrees clockwise from the top (Field's rim light, seen from the front: lower right).
    static let rimAngle = (atan2(Field.rimLight[0], Field.rimLight[1]) * 180) / Double.pi

    /// A field at `t` seconds, as its clock stands: its breath in its brightness, and (with `embers`) its embers, seeded by
    /// `seed` so two never drift as one.
    static func frame(_ clock: Clock, at t: Double, seed: UInt32 = 0, embers: Bool = false) -> Frame {
        let glow = clock.glow * (1 + clock.depth * sin(2 * Double.pi * clock.breath))
        return Frame(turn: clock.turn, glow: glow, rim: clock.rim, embers: embers && clock.embers > 0.01 ? embersAt(seed, t, clock.embers) : [])
    }

    /// A field still: at its rest (turned 0), in its mood's light (dimmed, or its rim red-brown), with no breath and no
    /// embers. What a row shows, a conversation's history, and every orb when motion is reduced.
    static func still(_ motion: Motion) -> Frame { Frame(turn: 0, glow: motion.glow, rim: motion.rim, embers: []) }

    private static func embersAt(_ seed: UInt32, _ t: Double, _ share: Double) -> [Ember] {
        (0..<Embers.count).map { i in
            let life = Embers.life.0 + (Embers.life.1 - Embers.life.0) * Orb.rand(seed, i, 70)
            let at = t / life + Orb.rand(seed, i, 71)
            let round = at.rounded(.down)
            let u = at - round
            // Each time it sets out, from somewhere else.
            let lot = seed &+ (UInt32(truncatingIfNeeded: Int64(round)) &* 0x9e37_79b1)
            let angle = ((rimAngle + Embers.spread * (2 * Orb.rand(lot, i, 72) - 1)) * Double.pi) / 180
            let reach = Embers.from.0 + (Embers.from.1 - Embers.from.0) * Orb.rand(lot, i, 73) + (Embers.drift.0 + (Embers.drift.1 - Embers.drift.0) * Orb.rand(lot, i, 74)) * u
            let fadeIn = min(1, u / 0.15)
            return Ember(
                x: reach * sin(angle),
                y: -reach * cos(angle) - Embers.rise * u,
                r: (Embers.size.0 + (Embers.size.1 - Embers.size.0) * Orb.rand(lot, i, 75)) * (1 - 0.4 * u),
                alpha: share * fadeIn * fadeIn * (3 - 2 * fadeIn) * (1 - u) * (1 - u)
            )
        }
    }

    // MARK: Its colours

    /// Where a failed field's rim dims to: a red-brown, an ember going out.
    static let rimDim = "#5a2416"

    /// A field's colours in a moment: its rim dimmed `rim` of the way (0.7 at most) towards red-brown.
    static func colours(_ colours: FieldColours, rim: Double) -> FieldColours {
        rim > 0.001 ? FieldColours(key: colours.key, rim: KnightOrb.blend(colours.rim, rimDim, 0.7 * min(1, rim))) : colours
    }

    /// How a point's light is shown on a dark page, as the icon shows it: three.js' ACES filmic tone mapping (r160) at the
    /// icon's exposure, to sRGB, 0 to 1 a channel. Bright light goes towards white and the faintest towards black, as on
    /// film: the lit face pale gold, the rim copper, the far lines all but gone.
    static let exposure = 1.12

    static func tone(_ r: Double, _ g: Double, _ b: Double, exposure: Double = exposure) -> (Double, Double, Double) {
        let e = exposure / 0.6
        let x = r * e, y = g * e, z = b * e
        func fit(_ v: Double) -> Double { (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081) }
        let f0 = fit(0.59719 * x + 0.35458 * y + 0.04823 * z), f1 = fit(0.076 * x + 0.90834 * y + 0.01566 * z), f2 = fit(0.0284 * x + 0.13383 * y + 0.83777 * z)
        func srgb(_ v: Double) -> Double {
            let c = max(0, min(1, v))
            return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
        }
        return (srgb(1.60475 * f0 - 0.53108 * f1 - 0.07367 * f2), srgb(-0.10208 * f0 + 1.10813 * f1 - 0.00605 * f2), srgb(-0.00327 * f0 - 0.07276 * f1 + 1.07602 * f2))
    }

    /// How a field's lines are drawn, from point to point along each (points): a line's width, from `least` where it is
    /// faintest to `least + more` where brightest, times its look's weight; under each line on a dark page, its light again
    /// `glowWidth` times as wide and `glowAlpha` as strong (close, so no fog: "less fog, so it reads clearer"); a line's
    /// width on a light page as a share of its width on a dark one; and how much of its points' light a line shows on a
    /// dark page, less again where it is smaller than `full`.
    enum Stroke {
        static let least = 0.42
        static let more = 0.5
        static let glowWidth = 3.2
        static let glowAlpha = 0.12
        static let ink = 0.85
        static let light = 0.22
        static let full = 96.0
    }

    /// How much of its points' light a field `size` wide shows on a dark page.
    static func strokeLight(_ size: Double) -> Double { Stroke.light * min(1, size / Stroke.full) }

    /// A field's inks on a light page, as sRGB (0 to 255 each): where its key light falls, its key's deep colour darkened
    /// (it would be white on white otherwise), and where its rim burns, its rim's, darkened less.
    struct Inks: Equatable, Sendable {
        let key: [Double]
        let rim: [Double]
    }

    static func inks(_ colours: FieldColours) -> Inks {
        func rgb(_ hex: String) -> [Double] { [1, 3, 5].map { Double(Int(hex.dropFirst($0).prefix(2), radix: 16) ?? 0) } }
        return Inks(key: rgb(KnightOrb.blend(colours.key[1], "#000000", 0.38)), rim: rgb(KnightOrb.blend(colours.rim, "#000000", 0.22)))
    }

    /// A point's ink on a light page, from the key's light on it and the rim's: between its two inks by their shares, and
    /// as opaque as it is lit, faint where it is dark (so the field keeps its depth on paper).
    static func ink(_ inks: Inks, lit: Double, rim: Double) -> (rgb: [Double], alpha: Double) {
        let total = lit + rim
        let share = total > 0 ? rim / total : 0
        return ((0..<3).map { inks.key[$0] + (inks.rim[$0] - inks.key[$0]) * share }, min(1, 0.1 + 0.95 * max(lit, rim)))
    }

    /// JavaScript's Math.round: the nearest whole number, a half towards +∞.
    static func jsRound(_ x: Double) -> Double {
        let down = x.rounded(.down)
        return x - down >= 0.5 ? down + 1 : down
    }

    private static func fract(_ x: Double) -> Double { x - x.rounded(.down) }

    /// An angle as 0 up to 2π radians.
    private static func turned(_ radians: Double) -> Double {
        let r = radians.truncatingRemainder(dividingBy: 2 * Double.pi)
        return r < 0 ? r + 2 * Double.pi : r
    }
}
