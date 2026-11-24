import SwiftUI
import Synchronization

/// Galahad as an orb (the PWA's ui/orb.ts): Orb's parts for its size, drawn in the colour of his state, the same in light
/// and dark. Where he is doing something (`mood`), it moves as that mood does (Orb.Mood; your word, 24 November 2026:
/// "pulsing/moving when doing a task, sitting idle, waiting, done"), a frame at a time and only as often as the mood
/// needs (Orb.fps), its motes and waves reaching out past its square over what is round it, which they never move or
/// take a touch from. Still, as an answer in a conversation's history shows him, and wherever the device asks for reduced
/// motion: the same parts, unmoved. Decorative beside his name; named (`label`) where it stands alone.
struct GalahadOrb: View {
    var size: CGFloat = 36
    var tone: Orb.Tone = .neutral
    var label: String? = nil
    /// What he is doing: it moves as that mood does, unless motion is reduced. Nil: still.
    var mood: Orb.Mood? = nil
    /// Which orb it is, so one drawn again (a new state, its screen drawn anew) carries on where it was, and a change of
    /// mood fades or bursts rather than starting afresh. His own when left out: all his orbs move as one.
    var key = "galahad"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let mood, !reduceMotion {
                MovingOrb(size: size, tone: tone, mood: mood, key: key)
            } else {
                let orb = PreparedOrb.of(Orb.level(Double(size)), tone)
                Canvas { context, canvas in
                    context.translateBy(x: canvas.width / 2, y: canvas.height / 2)
                    context.scaleBy(x: canvas.width / 200, y: canvas.height / 200)
                    OrbPainter.paint(orb, Orb.still, stage: nil, in: context)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(label ?? "")
        .accessibilityAddTraits(.isImage)
        .accessibilityHidden(label == nil)
    }
}

/// The orb moving: its stage's canvas (wider than its square, for its motes and waves) drawn on the animation's
/// timeline at its mood's pace, from its course (OrbCourses); its own square is all it takes of the layout.
private struct MovingOrb: View {
    let size: CGFloat
    let tone: Orb.Tone
    let mood: Orb.Mood
    let key: String
    /// Read again once a mood has arrived, so its pace drops from an arrival's to its own (OrbPace).
    @State private var paced = 0

    var body: some View {
        let _ = paced
        let level = Orb.level(Double(size))
        let stage = Orb.stage(level)
        let orb = PreparedOrb.of(level, tone)
        let seed: UInt32 = key == "galahad" ? 0 : Orb.seed(key)
        let reach = size * stage.reach / 100
        let fps = OrbCourses.shared.pace(key: key, mood: mood, level: level)
        TimelineView(.animation(minimumInterval: 1 / fps)) { timeline in
            let t = OrbCourses.seconds(timeline.date)
            Canvas { context, canvas in
                let frame = OrbCourses.shared.frame(key: key, mood: mood, seed: seed, at: t)
                context.translateBy(x: canvas.width / 2, y: canvas.height / 2)
                context.scaleBy(x: size / 200, y: size / 200)
                OrbPainter.paint(orb, frame, stage: stage, in: context)
            }
            .frame(width: reach, height: reach)
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
        .modifier(OrbPace(mood: mood, paced: $paced))
    }
}

/// The lights round a knight's face in its seat (the PWA's ui/orb.ts seatLights): its ring's glow breathing, the light
/// running round it, its waves and its motes, in its state's colour, over the still ring StandingRing draws, reaching a
/// quarter past it, at its mood's pace. The drawing itself is never moved, covered or recoloured. `box` is the seat's
/// width and `ring` its ring's line, in points. Nothing where the device asks for reduced motion: the ring says it still.
struct SeatLights: View {
    let box: CGFloat
    let ring: CGFloat
    let standing: Standing
    let key: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var paced = 0

    var body: some View {
        if !reduceMotion {
            let _ = paced
            let stage = Orb.ringStage
            let mood = Orb.Mood(standing)
            let lights = PreparedLights.of(Orb.Tone(standing))
            let seed = Orb.seed(key)
            let course = "seat:\(key)"
            // The ring in the units the stage is drawn in: 100 is its outer edge.
            let width = Double(ring * 200 / box)
            let reach = box * stage.reach / 100
            let fps = OrbCourses.shared.pace(key: course, mood: mood, level: nil)
            TimelineView(.animation(minimumInterval: 1 / fps)) { timeline in
                let t = OrbCourses.seconds(timeline.date)
                Canvas { context, canvas in
                    let frame = OrbCourses.shared.frame(key: course, mood: mood, seed: seed, at: t)
                    context.translateBy(x: canvas.width / 2, y: canvas.height / 2)
                    context.scaleBy(x: box / 200, y: box / 200)
                    OrbPainter.ringLights(frame, r: 100 - width / 2, width: width, stage: stage, lights, in: context)
                }
                .frame(width: reach, height: reach)
            }
            .frame(width: box, height: box)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .modifier(OrbPace(mood: mood, paced: $paced))
        }
    }
}

/// Reads an orb's pace again once its mood has arrived: an arrival (a burst, a fade) is drawn at its lively pace, and the
/// mood after it at its own, which the timeline only takes when its view is drawn anew.
private struct OrbPace: ViewModifier {
    let mood: Orb.Mood
    @Binding var paced: Int

    func body(content: Content) -> some View {
        content.task(id: mood) {
            try? await Task.sleep(for: .seconds(Orb.burstLength + 0.1))
            paced &+= 1
        }
    }
}

/// Each orb's own course, by its key (the PWA's keep and advance): its mood, the one before it, when it changed, whether
/// it burst, its clock, and the moment that was last stepped to. Begun settled on first sight; on a new mood the change
/// starts then. Its clock steps once a moment however many of its orbs are drawn. Behind a lock: a Canvas draws wherever
/// SwiftUI has it draw.
final class OrbCourses: Sendable {
    static let shared = OrbCourses()

    private struct Course {
        var mood: Orb.Mood
        var from: Orb.Mood?
        /// When it arrived at its mood, in seconds; never (minus infinity), on first sight.
        var at: Double
        var burst: Bool
        var clock: Orb.Clock
        var last: Double
    }

    private let courses = Mutex<[String: Course]>([:])
    /// The moment every orb's time is measured from: the app's start, so the numbers stay small.
    private static let epoch = Date()

    static func seconds(_ date: Date) -> Double { date.timeIntervalSince(epoch) }

    /// The orb `key`'s frame at `t`, in `mood`: its course kept, and its clock stepped on to `t` first.
    func frame(key: String, mood: Orb.Mood, seed: UInt32, at t: Double) -> Orb.Frame {
        courses.withLock { all in
            var course = all[key] ?? Course(mood: mood, from: nil, at: -.infinity, burst: false, clock: Orb.clock(mood, seed: seed), last: t)
            if course.mood != mood {
                course.from = course.mood
                course.burst = Orb.bursts(from: course.mood, to: mood)
                course.mood = mood
                course.at = t
            }
            if t > course.last {
                course.clock = Orb.step(course.clock, mood, t - course.last)
                course.last = t
            }
            all[key] = course
            return Orb.frame(mood, course.clock, t, seed: seed, since: course.at.isFinite ? t - course.at : nil, from: course.from, burst: course.burst)
        }
    }

    /// How many frames a second the orb `key` is drawn at now, in `mood` (Orb.fps): settled on first sight, lively while a
    /// new mood arrives (one it hasn't drawn yet arrives now).
    func pace(key: String, mood: Orb.Mood, level: Orb.Level?, at t: Double = OrbCourses.seconds(.now)) -> Double {
        courses.withLock { all in
            guard let course = all[key] else { return Orb.fps(mood, level, since: nil) }
            if course.mood != mood { return Orb.fps(mood, level, since: 0) }
            return Orb.fps(mood, level, since: course.at.isFinite ? t - course.at : nil)
        }
    }
}

/// An orb's parts made ready to draw a frame at a time (the PWA's prepared parts): each one's path in the orb's units and
/// its paint, made once for its level and its tone, so a frame only turns, swells and fills them. What brightens with the
/// glow (the halo, the core) keeps its stops, to be painted anew with each frame's glow.
struct PreparedOrb: Sendable {
    enum Turn: Sendable { case none, ring, ticks, segments }

    enum Paint: Sendable {
        /// A radial gradient lit from `center`, reaching `radius`; `stops` (its colours and opacities) where it glows.
        case radial(Gradient, center: CGPoint, radius: Double, stops: [Gradient.Stop]?, opacities: [Double])
        /// A stroke lit along the line from `from` to `to`.
        case linear(Gradient, from: CGPoint, to: CGPoint, width: Double)
        /// A stroke in one colour, its ends cut square.
        case stroke(Color, width: Double)
        case fill(Color)
    }

    struct Part: Sendable {
        let name: String
        let path: Path
        let paint: Paint
        let turn: Turn
        let swells: Bool
    }

    let parts: [Part]
    let hasHalo: Bool
    let lights: PreparedLights

    private static let made: [Orb.Level: [Orb.Tone: PreparedOrb]] = {
        var made: [Orb.Level: [Orb.Tone: PreparedOrb]] = [:]
        for level in [Orb.Level.badge, .seat, .full] {
            let size: Double = level == .badge ? 28 : level == .seat ? 64 : 168
            for tone in Orb.Tone.allCases { made[level, default: [:]][tone] = PreparedOrb(Orb.parts(size), Orb.palette(tone), lights: PreparedLights.of(tone)) }
        }
        return made
    }()

    /// The orb of a level in a tone, made the first time it's asked for.
    static func of(_ level: Orb.Level, _ tone: Orb.Tone) -> PreparedOrb { made[level]![tone]! }

    private init(_ parts: [Orb.Part], _ palette: Orb.Palette, lights: PreparedLights) {
        let ink = { (ink: Orb.Ink) -> Color in
            switch ink {
            case .tint: Color(hex: palette.tint)
            case .light: Color(hex: palette.light)
            case .deep: Color(hex: palette.deep)
            case .white: .white
            }
        }
        let gradient = { (stops: [Orb.Stop]) in Gradient(stops: stops.map { Gradient.Stop(color: ink($0.ink).opacity($0.opacity), location: $0.at) }) }
        self.parts = parts.map { part in
            let turn: Turn = Orb.Moves.ring.contains(part.name) ? .ring : Orb.Moves.ticks.contains(part.name) ? .ticks : Orb.Moves.segments.contains(part.name) ? .segments : .none
            let glows = Orb.Moves.glow.contains(part.name)
            let path: Path, paint: Paint
            switch part.kind {
            case let .disc(r, cx, cy, spread, stops):
                // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
                path = OrbPainter.circle(r)
                paint = .radial(gradient(stops), center: CGPoint(x: -r + cx * 2 * r, y: -r + cy * 2 * r), radius: spread * 2 * r,
                                stops: glows ? stops.map { Gradient.Stop(color: ink($0.ink), location: $0.at) } : nil, opacities: stops.map(\.opacity))
            case let .ring(r, width, color, opacity, arcs):
                var arcked = Path()
                if let arcs {
                    for arc in arcs {
                        arcked.move(to: OrbPainter.point(r, arc.from))
                        // (Degrees from the top, clockwise: the context's own angles start at three o'clock, y down.)
                        arcked.addArc(center: .zero, radius: r, startAngle: .degrees(arc.from - 90), endAngle: .degrees(arc.to - 90), clockwise: false)
                    }
                } else {
                    arcked = OrbPainter.circle(r)
                }
                path = arcked
                paint = .stroke(ink(color).opacity(opacity), width: width)
            case let .ticks(r, count, offset, length, width, color, opacity):
                var ticked = Path()
                for i in 0..<count {
                    let angle = offset + 360 * Double(i) / Double(count)
                    ticked.move(to: OrbPainter.point(r - length / 2, angle))
                    ticked.addLine(to: OrbPainter.point(r + length / 2, angle))
                }
                path = ticked
                paint = .stroke(ink(color).opacity(opacity), width: width)
            case let .rim(r, width, from, to, stops):
                path = OrbPainter.circle(r)
                paint = .linear(gradient(stops), from: CGPoint(x: from.x, y: from.y), to: CGPoint(x: to.x, y: to.y), width: width)
            case let .shine(cx, cy, rx, ry, rotate, opacity):
                // Turned about its own middle, then moved there: the turn made once, into its path.
                path = Path(ellipseIn: CGRect(x: -rx, y: -ry, width: 2 * rx, height: 2 * ry))
                    .applying(CGAffineTransform(rotationAngle: rotate * .pi / 180).concatenating(CGAffineTransform(translationX: cx, y: cy)))
                paint = .fill(.white.opacity(opacity))
            }
            return Part(name: part.name, path: path, paint: paint, turn: turn, swells: Orb.Moves.swell.contains(part.name))
        }
        hasHalo = parts.contains { $0.name == "halo" }
        self.lights = lights
    }
}

/// What a tone's lights are painted with (its waves, its light, its motes), made once for each tone: its tint, its lit
/// tint, and a point of light, white at its heart, its lit tint, then its glow fading to nothing.
struct PreparedLights: Sendable {
    let tint: Color
    let light: Color
    let spark: Gradient

    private static let made: [Orb.Tone: PreparedLights] = Dictionary(uniqueKeysWithValues: Orb.Tone.allCases.map { tone in
        let palette = Orb.palette(tone)
        return (tone, PreparedLights(
            tint: Color(hex: palette.tint),
            light: Color(hex: palette.light),
            spark: Gradient(stops: [
                .init(color: .white, location: 0),
                .init(color: Color(hex: palette.light).opacity(0.95), location: 0.18),
                .init(color: Color(hex: palette.tint).opacity(0.4), location: 0.45),
                .init(color: Color(hex: palette.tint).opacity(0), location: 1),
            ])
        ))
    })

    static func of(_ tone: Orb.Tone) -> PreparedLights { made[tone]! }
}

/// Drawing an orb's frame in a context already moved to its middle and scaled to its square's units (200 wide): the
/// parts as the frame moves them (Orb.Moves), and its lights among them, as the PWA's ui/orb.ts draws them.
enum OrbPainter {
    /// Steps a light's tail is drawn in, each brighter and wider than the one behind it.
    private static let tailSteps = 18

    /// The orb's parts as `frame` moves them; with a `stage`, its waves, its light and its motes too (none, still).
    static func paint(_ orb: PreparedOrb, _ frame: Orb.Frame, stage: Orb.Stage?, in context: GraphicsContext) {
        if let stage, !orb.hasHalo { waves(frame, stage, orb.lights, in: context) }
        for part in orb.parts {
            if let stage, part.name == Orb.Moves.lightsBefore {
                if let light = frame.comet, let track = stage.comet { comet(light, r: track.r, width: track.width, orb.lights, in: context) }
                motes(Orb.shownMotes(frame, stage), stage, orb.lights, in: context)
            }
            var moved = context
            let turn = switch part.turn {
            case .none: 0.0
            case .ring: frame.ring
            case .ticks: frame.ticks
            case .segments: frame.segments
            }
            if turn != 0 { moved.rotate(by: .degrees(turn)) }
            if part.swells && frame.scale != 1 { moved.scaleBy(x: frame.scale, y: frame.scale) }
            switch part.paint {
            case let .radial(gradient, center, radius, stops, opacities):
                // What glows is painted anew with this frame's glow (no stop past opaque); the rest as it was made.
                let painted = if let stops, frame.glow != 1 {
                    Gradient(stops: zip(stops, opacities).map { Gradient.Stop(color: $0.color.opacity(min(1, $1 * frame.glow)), location: $0.location) })
                } else { gradient }
                moved.fill(part.path, with: .radialGradient(painted, center: center, startRadius: 0, endRadius: radius))
            case let .linear(gradient, from, to, width):
                moved.stroke(part.path, with: .linearGradient(gradient, startPoint: from, endPoint: to), lineWidth: width)
            case let .stroke(color, width):
                moved.stroke(part.path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .butt))
            case let .fill(color):
                moved.fill(part.path, with: .color(color))
            }
            if let stage, part.name == "halo" { waves(frame, stage, orb.lights, in: context) }
        }
    }

    /// A knight's ring's lights: a bloom and a closer glow (its ring's own light, swelling and fading with its breath),
    /// its waves, the light running round it, and its motes. `r` and `width` are its ring's, in the stage's units.
    static func ringLights(_ frame: Orb.Frame, r: Double, width: Double, stage: Orb.Stage, _ lights: PreparedLights, in context: GraphicsContext) {
        if frame.aura > 0.005 {
            let ring = circle(r)
            context.stroke(ring, with: .color(lights.tint.opacity(frame.aura * 0.28)), lineWidth: width * 6)
            context.stroke(ring, with: .color(lights.tint.opacity(frame.aura * 0.6)), lineWidth: width * 2.6)
        }
        waves(frame, stage, lights, in: context)
        if let light = frame.comet { comet(light, r: r, width: max(width * 1.6, 3), lights, in: context) }
        motes(Orb.shownMotes(frame, stage), stage, lights, in: context)
    }

    /// Its waves: rings of its light going out from its edge, thinning and fading as they go.
    private static func waves(_ frame: Orb.Frame, _ stage: Orb.Stage, _ lights: PreparedLights, in context: GraphicsContext) {
        for gone in frame.ripples {
            let r = stage.waves.from + gone * (stage.waves.to - stage.waves.from)
            context.stroke(circle(r), with: .color(lights.tint.opacity(0.6 * pow(1 - gone, 2))), lineWidth: stage.wave * (1 - 0.6 * gone))
        }
    }

    /// Its light: a head of white running round `r`, its tail in the lit tint, fading and thinning behind it.
    private static func comet(_ light: Orb.Light, r: Double, width: Double, _ lights: PreparedLights, in context: GraphicsContext) {
        let step = light.tail / Double(tailSteps)
        for j in 0..<tailSteps {
            let along = Double(j + 1) / Double(tailSteps)
            let from = light.head - light.tail + Double(j) * step
            var path = Path()
            path.addArc(center: .zero, radius: r, startAngle: .degrees(from - 90), endAngle: .degrees(from + step - 90), clockwise: false)
            context.stroke(path, with: .color(lights.light.opacity(light.alpha * pow(along, 1.6))), style: StrokeStyle(lineWidth: width * (0.35 + 0.65 * along), lineCap: .round))
        }
        var glowing = context
        glowing.opacity = light.alpha
        spark(at: point(r, light.head), radius: width * 2.2, lights.spark, in: glowing)
    }

    /// Its motes, each a point of light with a glow round it, where the frame puts them in the stage's band.
    private static func motes(_ shown: [Orb.Mote], _ stage: Orb.Stage, _ lights: PreparedLights, in context: GraphicsContext) {
        for mote in shown where mote.alpha > 0.01 {
            var faded = context
            faded.opacity = mote.alpha
            spark(at: point(stage.band.from + mote.u * (stage.band.to - stage.band.from), mote.angle), radius: stage.mote * mote.size * 2, lights.spark, in: faded)
        }
    }

    private static func spark(at center: CGPoint, radius: Double, _ gradient: Gradient, in context: GraphicsContext) {
        context.fill(Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius)), with: .radialGradient(gradient, center: center, startRadius: 0, endRadius: radius))
    }

    static func circle(_ r: Double) -> Path { Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r)) }

    /// The point `r` from the middle at `angle` degrees clockwise from the top (y down).
    static func point(_ r: Double, _ angle: Double) -> CGPoint {
        let radians = angle * .pi / 180
        return CGPoint(x: r * sin(radians), y: -r * cos(radians))
    }
}
