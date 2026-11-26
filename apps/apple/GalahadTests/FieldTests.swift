import Foundation
import Testing
@testable import Galahad

extension Vectors {
    /// The orbs as fields (the PWA's own lib/field.ts and lib/field-orb.ts): the lights, whose field each is, a field's
    /// lines and points at given turns, where they fall on a picture, each size's look, his ring, how a field moves in each
    /// mood (its clock, its frames, its embers), its tints and its light and ink.
    struct FieldCases: Decodable {
        struct Lights: Decodable { let key: [Double]; let rim: [Double]; let exposure: Double }
        struct Knight: Decodable { let handle: String; let profile: JSONValue?; let field: FieldIdentity }
        struct Linear: Decodable { let hex: String; let rgb: [Double] }
        struct Shade: Decodable {
            struct Shown: Decodable { let rgb: [Double]; let k: Double; let lit: Double; let rim: Double }
            let n: [Double]
            let colours: FieldColours
            let shade: Shown
        }
        struct Model: Decodable { let lines: Int; let seed: Int; let phi: [Double]; let width: [Double] }
        struct Points: Decodable {
            struct Options: Decodable { let lines: Int; let steps: Int; let tilt: [Double]; let seed: Int; let colours: FieldColours; let weight: Double; let turn: Double }
            struct Point: Decodable { let at: Int; let x: Double; let y: Double; let z: Double; let rgb: [Double]; let size: Double; let lit: Double; let rim: Double }
            let who: String
            let size: Double
            let ringed: Bool
            let turn: Double
            let rim: Double
            let options: Options
            let colours: FieldColours
            let points: [Point]
        }
        struct Projection: Decodable {
            struct Shown: Decodable { let x: Double; let y: Double; let d: Double; let visible: Bool }
            let who: String
            let size: Double
            let zoom: Double
            let shown: [Shown]
        }
        struct LookCase: Decodable { let who: String; let size: Double; let ringed: Bool; let look: FieldOrb.Look }
        struct Ring: Decodable {
            struct Seat: Decodable { let from: Double; let to: Double; let width: Double }
            struct Pair: Decodable { let dark: String; let paper: String }
            struct Ink: Decodable { struct Alpha: Decodable { let dark: Double; let paper: Double }; let dark: String; let paper: String; let alpha: Alpha }
            struct Width: Decodable { let size: Double; let width: Double }
            let r: Double
            let width: Double
            let arcs: [[Double]]
            let seat: Seat
            let ink: Ink
            let oxblood: Pair
            let widths: [Width]
        }
        struct Stroke: Decodable {
            struct Glow: Decodable { let width: Double; let alpha: Double }
            struct Light: Decodable { let size: Double; let light: Double }
            let least: Double
            let more: Double
            let glow: Glow
            let ink: Double
            let light: Double
            let full: Double
            let lights: [Light]
        }
        struct Motion: Decodable { let turn: Double; let glow: Double; let breath: FieldOrb.Motion.Breath?; let embers: Bool; let rim: Double }
        struct Embers: Decodable { let count: Int; let life: [Double]; let from: [Double]; let drift: [Double]; let rise: Double; let spread: Double; let size: [Double]; let rimAngle: Double }
        struct Frame: Decodable { let turn: Double; let glow: Double; let rim: Double; let embers: [FieldOrb.Ember] }
        struct ClockCase: Decodable { let mood: String; let clock: FieldOrb.Clock; let still: Frame }
        struct Step: Decodable { let knight: Bool; let mood: String; let dt: Double; let clock: FieldOrb.Clock; let fps: Double }
        struct FrameCase: Decodable { let clock: FieldOrb.Clock; let t: Double; let seed: UInt32; let embers: Bool; let frame: Frame }
        struct Tints: Decodable {
            struct Rim: Decodable { let rim: Double; let aurum: FieldColours; let gareth: FieldColours }
            let dim: String
            let rims: [Rim]
        }
        struct Tone: Decodable { let rgb: [Double]; let exposure: Double; let shown: [Double] }
        struct InkCase: Decodable {
            struct Inks: Decodable { let key: [Double]; let rim: [Double] }
            struct Shown: Decodable { struct Ink: Decodable { let rgb: [Double]; let alpha: Double }; let lit: Double; let rim: Double; let ink: Ink }
            let colours: FieldColours
            let inks: Inks
            let keyRgb: [Double]
            let shown: [Shown]
        }
        let lights: Lights
        let galahad: FieldIdentity
        let knights: [Knight]
        let linear: [Linear]
        let shades: [Shade]
        let models: [Model]
        let points: [Points]
        let projections: [Projection]
        let looks: [LookCase]
        let ring: Ring
        let stroke: Stroke
        let motion: [String: Motion]
        let knightMotion: [String: Motion]
        let ease: Double
        let embers: Embers
        let clocks: [ClockCase]
        let steps: [Step]
        let frames: [FrameCase]
        let tints: Tints
        let tones: [Tone]
        let inks: [InkCase]
    }
}

/// Every orb as Galahad's field, as the PWA draws it (lib/field.ts, lib/field-orb.ts; 26 November 2026): its lights,
/// whose field each is, its points at given turns, its looks, his ring, how it moves in each mood, its embers, tints,
/// light and ink, checked against the PWA's own output to within a billionth.
struct FieldTests {
    let field = Vectors.shared.field
    static let within = 1e-9

    private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) <= Self.within * max(1, abs(a), abs(b)) }
    private func near(_ a: [Double], _ b: [Double]) -> Bool { a.count == b.count && zip(a, b).allSatisfy { near($0, $1) } }

    @Test func itsLightsAreThePWAs() {
        #expect(near(Field.key, field.lights.key))
        #expect(near(Field.rimLight, field.lights.rim))
        #expect(FieldOrb.exposure == field.lights.exposure)
        #expect(FieldOrb.galahad == field.galahad)
    }

    @Test func eachKnightsFieldIsThePWAs() {
        #expect(field.knights.count >= 5)
        for knight in field.knights {
            let mine = FieldOrb.knight(knight.handle, profile: knight.profile)
            #expect(mine.seed == knight.field.seed, "\(knight.handle)")
            #expect(mine.lines == knight.field.lines, "\(knight.handle)")
            #expect(near(mine.tilt, knight.field.tilt), "\(knight.handle)")
            #expect(mine.colours == knight.field.colours, "\(knight.handle)")
            // Seen from the side, never end on or flat; 12 to 20 lines.
            #expect((12...20).contains(mine.lines))
        }
    }

    @Test func coloursAreReadInLinearLightAsThePWAReadsThem() {
        for item in field.linear {
            let rgb = Field.linear(item.hex)
            #expect(near([rgb.r, rgb.g, rgb.b], item.rgb), "\(item.hex)")
        }
    }

    @Test func aPointIsShadedAsThePWAShadesIt() {
        for item in field.shades {
            let s = Field.shadeLit(item.n[0], item.n[1], item.n[2], Field.light(item.colours))
            #expect(near([s.rgb.r, s.rgb.g, s.rgb.b], item.shade.rgb), "\(item.n)")
            #expect(near(s.k, item.shade.k) && near(s.lit, item.shade.lit) && near(s.rim, item.shade.rim), "\(item.n)")
        }
    }

    @Test func aFieldsLinesAreItsSeeds() {
        for item in field.models {
            let model = Field.model(lines: item.lines, steps: 4, seed: item.seed)
            #expect(near(model.phi, item.phi), "\(item.seed)")
            #expect(near(model.width, item.width), "\(item.seed)")
        }
    }

    @Test func aFieldsPointsAreThePWAsAtEveryTurn() {
        #expect(field.points.count == 5)
        for item in field.points {
            let o = item.options
            let model = Field.model(lines: o.lines, steps: o.steps, tilt: o.tilt, weight: o.weight, colours: o.colours, seed: o.seed)
            #expect(FieldOrb.colours(o.colours, rim: item.rim) == item.colours, "\(item.who)")
            var buffer = Field.Buffer(model)
            let count = Field.at(model, turn: o.turn, into: &buffer, light: Field.light(item.colours))
            #expect(count == item.points.count, "\(item.who)")
            for (i, p) in item.points.prefix(count).enumerated() {
                #expect(buffer.at[i] == p.at, "\(item.who) \(i)")
                #expect(near([buffer.x[i], buffer.y[i], buffer.z[i]], [p.x, p.y, p.z]), "\(item.who) \(i)")
                #expect(near([buffer.r[i], buffer.g[i], buffer.b[i]], p.rgb), "\(item.who) \(i)")
                #expect(near(buffer.size[i], p.size) && near(buffer.lit[i], p.lit) && near(buffer.rim[i], p.rim), "\(item.who) \(i)")
            }
            // Its look at that size gives the same lines and weight as the vectors were made with.
            let identity = item.who.hasPrefix("galahad") ? FieldOrb.galahad : FieldOrb.knight(item.who.hasPrefix("ada") ? "ada" : item.who, profile: item.who == "ada, chosen" ? .object(["v": .number(2), "color": .string("#3ABEFF")]) : nil)
            let look = FieldOrb.look(identity, size: item.size, ringed: item.ringed)
            #expect(look.lines == o.lines && look.weight == o.weight, "\(item.who)")
        }
    }

    @Test func noPointIsInsideTheCoreAndNoneIsDark() {
        // The core stays dark: no line inside it, and nothing the lights leave dark is drawn (the "nipple" is gone).
        for identity in [FieldOrb.galahad, FieldOrb.knight("ada"), FieldOrb.knight("gareth")] {
            let model = Field.model(lines: identity.lines, steps: 60, tilt: identity.tilt, colours: identity.colours, seed: identity.seed)
            var buffer = Field.Buffer(model)
            let count = Field.at(model, turn: 0.7, into: &buffer)
            #expect(count > 0)
            for i in 0..<count {
                #expect(Field.hypot3(buffer.x[i], buffer.y[i], buffer.z[i]) >= 0.32 * 1.05 - 1e-12)
            }
        }
    }

    @Test func aPointFallsOnAPictureAsThePWAPlacesIt() {
        // (Three sizes for each of the first three sets of points, in order: two of those sets are his.)
        #expect(field.projections.count == 9)
        for (i, item) in field.projections.enumerated() {
            let set = field.points[i / 3]
            #expect(set.who == item.who)
            for (p, shown) in zip(set.points.prefix(item.shown.count), item.shown) {
                let placed = Field.project(x: p.x, y: p.y, z: p.z, size: p.size, picture: item.size, zoom: item.zoom)
                #expect(near([placed.x, placed.y, placed.d], [shown.x, shown.y, shown.d]), "\(item.who) \(item.size)")
                #expect(placed.visible == shown.visible)
            }
        }
    }

    @Test func eachSizeLooksAsThePWAsDoes() {
        for item in field.looks {
            let identity = item.who == "galahad" ? FieldOrb.galahad : FieldOrb.knight(item.who)
            #expect(FieldOrb.look(identity, size: item.size, ringed: item.ringed) == item.look, "\(item.who) \(item.size)")
        }
    }

    @Test func hisRingIsThePWAs() {
        let ring = field.ring
        #expect(FieldOrb.Ring.r == ring.r && FieldOrb.Ring.width == ring.width)
        #expect(FieldOrb.Ring.arcs.map { [$0.from, $0.to] } == ring.arcs)
        #expect(FieldOrb.Ring.seat.from == ring.seat.from && FieldOrb.Ring.seat.to == ring.seat.to && FieldOrb.Ring.seat.width == ring.seat.width)
        #expect(FieldOrb.Ring.ink.dark == ring.ink.dark && FieldOrb.Ring.ink.paper == ring.ink.paper)
        #expect(FieldOrb.Ring.inkAlpha.dark == ring.ink.alpha.dark && FieldOrb.Ring.inkAlpha.paper == ring.ink.alpha.paper)
        #expect(FieldOrb.Ring.oxblood.dark == ring.oxblood.dark && FieldOrb.Ring.oxblood.paper == ring.oxblood.paper)
        for item in ring.widths { #expect(near(FieldOrb.ringWidth(item.size), item.width), "\(item.size)") }
    }

    @Test func itsStrokesAreThePWAs() {
        let stroke = field.stroke
        #expect(FieldOrb.Stroke.least == stroke.least && FieldOrb.Stroke.more == stroke.more)
        #expect(FieldOrb.Stroke.glowWidth == stroke.glow.width && FieldOrb.Stroke.glowAlpha == stroke.glow.alpha)
        #expect(FieldOrb.Stroke.ink == stroke.ink && FieldOrb.Stroke.light == stroke.light && FieldOrb.Stroke.full == stroke.full)
        for item in stroke.lights { #expect(near(FieldOrb.strokeLight(item.size), item.light), "\(item.size)") }
    }

    @Test func eachMoodMovesAsThePWAsAndAKnightOnlyAtWork() {
        #expect(Set(Orb.Mood.allCases.map(\.rawValue)) == Set(field.motion.keys))
        for mood in Orb.Mood.allCases {
            for (knight, theirs) in [(false, field.motion[mood.rawValue]!), (true, field.knightMotion[mood.rawValue]!)] {
                let mine = FieldOrb.motion(mood, knight: knight)
                #expect(mine.turn == theirs.turn && mine.glow == theirs.glow && mine.embers == theirs.embers && mine.rim == theirs.rim, "\(mood) \(knight)")
                #expect(mine.breath == theirs.breath, "\(mood) \(knight)")
            }
            // A knight is still in every mood but work; slow and calm in all of them.
            #expect((FieldOrb.motion(mood, knight: true).turn > 0) == (mood == .working))
            #expect(FieldOrb.motion(mood, knight: false).turn <= 0.2)
        }
        #expect(FieldOrb.ease == field.ease)
    }

    @Test func hisEmbersAreThePWAs() {
        let embers = field.embers
        #expect(FieldOrb.Embers.count == embers.count)
        #expect([FieldOrb.Embers.life.0, FieldOrb.Embers.life.1] == embers.life)
        #expect([FieldOrb.Embers.from.0, FieldOrb.Embers.from.1] == embers.from)
        #expect([FieldOrb.Embers.drift.0, FieldOrb.Embers.drift.1] == embers.drift)
        #expect([FieldOrb.Embers.size.0, FieldOrb.Embers.size.1] == embers.size)
        #expect(FieldOrb.Embers.rise == embers.rise && FieldOrb.Embers.spread == embers.spread)
        #expect(near(FieldOrb.rimAngle, embers.rimAngle))
    }

    @Test func aFieldIsFirstSeenAtRestAndStillAsThePWAs() {
        for item in field.clocks {
            let motion = FieldOrb.motions[Orb.Mood(rawValue: item.mood)!]!
            #expect(FieldOrb.clock(motion) == item.clock, "\(item.mood)")
            let still = FieldOrb.still(motion)
            #expect(still.turn == item.still.turn && still.glow == item.still.glow && still.rim == item.still.rim && still.embers.isEmpty && item.still.embers.isEmpty, "\(item.mood)")
        }
    }

    @Test func itsClockStepsAsThePWAsThroughEveryMood() {
        #expect(field.steps.count == 24)
        var clocks: [Bool: FieldOrb.Clock] = [false: FieldOrb.clock(FieldOrb.motion(.idle, knight: false)), true: FieldOrb.clock(FieldOrb.motion(.idle, knight: true))]
        for item in field.steps {
            let motion = FieldOrb.motion(Orb.Mood(rawValue: item.mood)!, knight: item.knight)
            let clock = FieldOrb.step(clocks[item.knight]!, motion, item.dt)
            let c = item.clock
            #expect(near([clock.turn, clock.speed, clock.glow, clock.rim, clock.depth, clock.breath, clock.period, clock.embers], [c.turn, c.speed, c.glow, c.rim, c.depth, c.breath, c.period, c.embers]), "\(item.mood) \(item.dt) \(item.knight)")
            #expect(FieldOrb.fps(clock, motion) == item.fps, "\(item.mood) \(item.dt) \(item.knight)")
            // Carried on from the PWA's own clock, so a last digit never builds up.
            clocks[item.knight] = c
        }
    }

    @Test func aFieldComesToRestAndThenDrawsNothing() {
        // Nothing redraws at rest: a knight not at work settles to no frames at all, and Galahad to a slow turn.
        var clock = FieldOrb.clock(FieldOrb.motion(.working, knight: true))
        let resting = FieldOrb.motion(.idle, knight: true)
        for _ in 0..<600 { clock = FieldOrb.step(clock, resting, 1.0 / 30) }
        #expect(FieldOrb.fps(clock, resting) == 0)
        var his = FieldOrb.clock(FieldOrb.motion(.working, knight: false))
        let idle = FieldOrb.motion(.idle, knight: false)
        for _ in 0..<600 { his = FieldOrb.step(his, idle, 1.0 / 30) }
        #expect(FieldOrb.fps(his, idle) == 15)
    }

    @Test func aFramesEmbersAreThePWAs() {
        for item in field.frames {
            let frame = FieldOrb.frame(item.clock, at: item.t, seed: item.seed, embers: item.embers)
            #expect(near([frame.turn, frame.glow, frame.rim], [item.frame.turn, item.frame.glow, item.frame.rim]), "\(item.t)")
            #expect(frame.embers.count == item.frame.embers.count, "\(item.t)")
            for (mine, theirs) in zip(frame.embers, item.frame.embers) {
                #expect(near([mine.x, mine.y, mine.r, mine.alpha], [theirs.x, theirs.y, theirs.r, theirs.alpha]), "\(item.t)")
                // Inside his ring always.
                #expect((mine.x * mine.x + mine.y * mine.y).squareRoot() < 0.93)
            }
        }
    }

    @Test func aFailedRimDimsAsThePWAs() {
        #expect(FieldOrb.rimDim == field.tints.dim)
        for item in field.tints.rims {
            #expect(FieldOrb.colours(Field.aurum, rim: item.rim) == item.aurum, "\(item.rim)")
            #expect(FieldOrb.colours(FieldOrb.knight("gareth").colours, rim: item.rim) == item.gareth, "\(item.rim)")
        }
    }

    @Test func lightIsShownOnADarkPageAsTheIconShowsIt() {
        for item in field.tones {
            let shown = FieldOrb.tone(item.rgb[0], item.rgb[1], item.rgb[2], exposure: item.exposure)
            #expect(near([shown.0, shown.1, shown.2], item.shown), "\(item.rgb) \(item.exposure)")
        }
    }

    @Test func onALightPageItIsInkAsThePWAs() {
        for item in field.inks {
            let inks = FieldOrb.inks(item.colours)
            #expect(inks.key == item.inks.key && inks.rim == item.inks.rim, "\(item.colours)")
            for shown in item.shown {
                let ink = FieldOrb.ink(inks, lit: shown.lit, rim: shown.rim)
                #expect(near(ink.rgb, shown.ink.rgb) && near(ink.alpha, shown.ink.alpha), "\(shown.lit) \(shown.rim)")
            }
        }
    }
}
