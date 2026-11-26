import SwiftUI
import Synchronization

/*
 * The orbs (26 November 2026), as the PWA's ui/orb.ts draws them: every orb is Galahad's field (Field.swift,
 * FieldOrb.swift). His is in gold, with his lance of light through it along his axis (your word, 26 November 2026, of the
 * heads-up ring he wore until then: "remove the old mark around galahad. make the primary agent distinct in some other
 * cool way"); a knight's is in its own colours, with no lance. The app's own mark is his field alone (AppMark). Each line
 * of a field is a stroke from point to point, added to the others on a dark page (.plusLighter) with a close, faint glow
 * under it and no fog; on a light page it is ink. Where it is one of many (a row, a conversation's history) an orb is
 * still, drawn once into a picture that every row showing the same orb shares; where it is the one you are looking at, it
 * moves as its mood does (slowly: "slow and calming movement", "i dont want them to be too visually distractin"), only
 * while the app is in front, never where the device asks for reduced motion, and not at all once it has come to rest.
 * Nothing in it comes from a name's meaning: a knight's colour is one you chose or its handle's, and its handle gives its
 * field.
 */

/// Galahad's orb: his field in gold, his lance through it. `tone` is where he stands: his field is gold in every state,
/// his mood moves it, and the words beside him say where he stands. Decorative beside his name; named (`label`) where it
/// stands alone.
struct GalahadOrb: View {
    var size: CGFloat = 36
    var tone: Orb.Tone = .neutral
    var label: String? = nil
    /// What he is doing: it moves as that mood does, unless motion is reduced. Nil: still.
    var mood: Orb.Mood? = nil
    /// Which orb it is, so one drawn again carries on where it was and a change of mood eases rather than starting afresh.
    var key = "galahad"

    var body: some View {
        FieldOrbView(identity: FieldOrb.galahad, lance: true, knight: false, size: size, mood: mood, key: key)
            .orbLabel(label)
    }
}

/// The app's mark where a page shows it (Settings' About, joining, a Mac's first run): the app icon's field, his in gold,
/// alone (no lance: that is his as the one you talk to), still, and on nothing, so it sits on a light page as on a dark one
/// (your word, 26 November 2026: "make sure the app icon is transparent so it works in dark and white mode"): light added
/// to light on a dark page, ink on a light one, as every orb is. Decorative: what it is in is named.
struct AppMark: View {
    var size: CGFloat = 40

    var body: some View {
        FieldOrbView(identity: FieldOrb.galahad, lance: false, knight: false, size: size, key: "galahad:mark")
            .accessibilityHidden(true)
    }
}

/// A knight's orb: its field in its own colours (FieldOrb.knight: the colour you chose or its handle's, and its handle's
/// lines and lean, the same on every device). It moves only while it works, turning slowly; in any other mood it is still,
/// in that mood's light (dimmer while paused or queued, its rim red-brown when its work failed).
struct KnightFace: View {
    /// Its handle.
    let id: String
    /// Its saved avatar: a colour you chose for it (core's OrbProfile); anything else is its handle's colour.
    var profile: JSONValue? = nil
    var size: CGFloat = 40
    /// What it is doing, as its orb's mood; nil: still (a row, a speaker in a conversation's history).
    var mood: Orb.Mood? = nil
    var label: String? = nil
    /// Which course it moves on: `face:<handle>` when left out.
    var key: String? = nil

    var body: some View {
        FieldOrbView(identity: FieldOrb.knight(id, profile: profile), lance: false, knight: true, size: size, mood: mood, key: key ?? "face:\(id)")
            .orbLabel(label)
    }
}

extension View {
    /// An orb's name for VoiceOver, where it stands alone; beside its name it is decorative.
    fileprivate func orbLabel(_ label: String?) -> some View {
        accessibilityElement()
            .accessibilityLabel(label ?? "")
            .accessibilityAddTraits(.isImage)
            .accessibilityHidden(label == nil)
    }
}

/// A field drawn: still where it has no mood, or a mood with nothing to move and no course under way to come to rest from
/// (the picture every such orb shares); moving otherwise.
struct FieldOrbView: View {
    let identity: FieldIdentity
    /// His lance through it: his orb's, never a knight's nor the app's mark.
    let lance: Bool
    let knight: Bool
    let size: CGFloat
    var mood: Orb.Mood? = nil
    let key: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.displayScale) private var scale

    var body: some View {
        let paper = scheme == .light
        let motion = mood.map { FieldOrb.motion($0, knight: knight) }
        Group {
            if let mood, let motion, motion.moves || FieldCourses.shared.has(key) {
                MovingField(identity: identity, lance: lance, knight: knight, size: size, mood: mood, key: key, paper: paper)
            } else {
                StillField(identity: identity, lance: lance, knight: knight, size: size, frame: FieldOrb.still(motion ?? FieldOrb.Motion.still), paper: paper, scale: scale)
                    .equatable()
            }
        }
        .frame(width: size, height: size)
    }
}

extension FieldOrb.Motion {
    /// What a still orb shows: a field at rest, in no mood's light.
    static let still = FieldOrb.Motion(turn: 0, glow: 1, breath: nil, embers: false, rim: 0)
    /// Whether it moves anything once it has arrived.
    var moves: Bool { turn > 0 || breath != nil || embers }
}

/// A still orb: its picture, drawn once for each field, look, light, page and screen, and shared by every row that shows
/// it. Compared by what it is drawn from, so a row drawn again draws nothing.
private struct StillField: View, Equatable {
    let identity: FieldIdentity
    let lance: Bool
    let knight: Bool
    let size: CGFloat
    let frame: FieldOrb.Frame
    let paper: Bool
    let scale: CGFloat

    var body: some View {
        if let image = FieldStills.shared.image(identity: identity, lance: lance, knight: knight, size: size, frame: frame, paper: paper, scale: scale) {
            Image(decorative: image, scale: scale)
                .resizable()
                .interpolation(.high)
                .frame(width: size, height: size)
        } else {
            Color.clear.frame(width: size, height: size)
        }
    }
}

/// The orb in focus, moving: a frame at a time, as often as its mood needs (FieldOrb.fps: 30 while a mood arrives or
/// embers drift, 20 breathing, 15 turning), on its course; nothing at all once it has come to rest, while the app is not in
/// front, or where the device asks for reduced motion (then one still frame in its mood's light).
private struct MovingField: View {
    let identity: FieldIdentity
    let lance: Bool
    let knight: Bool
    let size: CGFloat
    let mood: Orb.Mood
    let key: String
    let paper: Bool
    @State private var frame: FieldOrb.Frame?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    /// What the loop runs for: a new mood, a change of motion's leave or the app coming to the front starts it again.
    private struct Run: Equatable {
        let key: String
        let mood: Orb.Mood
        let moving: Bool
    }

    var body: some View {
        let shown = frame ?? FieldCourses.shared.resting(key: key, motion: FieldOrb.motion(mood, knight: knight))
        Canvas { context, canvas in
            context.withCGContext { g in
                FieldPainter.paint(g, size: canvas.width, identity: identity, galahad: !knight, lance: lance, frame: shown, paper: paper)
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
        .task(id: Run(key: key, mood: mood, moving: !reduceMotion && scenePhase == .active)) { await run(moving: !reduceMotion && scenePhase == .active) }
    }

    private func run(moving: Bool) async {
        let motion = FieldOrb.motion(mood, knight: knight)
        let seed = Orb.seed(key)
        while !Task.isCancelled {
            let (next, fps) = FieldCourses.shared.advance(key: key, motion: motion, seed: seed, embers: !knight, at: FieldCourses.seconds(.now), moving: moving)
            frame = next
            guard moving, fps > 0 else { return }
            try? await Task.sleep(for: .seconds(1 / fps))
        }
    }
}

/// Each moving orb's course, by its key (the PWA's keep and advance): its motion, its clock, and the moment it was last
/// stepped to. Begun settled on first sight, at its rest; drawn again in a new mood, it eases there from where it was.
final class FieldCourses: Sendable {
    static let shared = FieldCourses()

    private struct Course {
        var motion: FieldOrb.Motion
        var clock: FieldOrb.Clock
        var last: Double
    }

    private let courses = Mutex<[String: Course]>([:])
    private static let epoch = Date()

    static func seconds(_ date: Date) -> Double { date.timeIntervalSince(epoch) }

    func has(_ key: String) -> Bool { courses.withLock { $0[key] != nil } }

    /// Its frame now without stepping it: where it stands, at rest in its motion's light.
    func resting(key: String, motion: FieldOrb.Motion) -> FieldOrb.Frame {
        let turn = courses.withLock { $0[key]?.clock.turn } ?? 0
        let still = FieldOrb.still(motion)
        return FieldOrb.Frame(turn: turn, glow: still.glow, rim: still.rim, embers: [])
    }

    /// Its frame at `t`, its clock stepped on to it first (once a moment, however many of its orbs are drawn), and how many
    /// frames a second it needs now. Not `moving` (motion reduced, the app not in front): still, where its course stands.
    func advance(key: String, motion: FieldOrb.Motion, seed: UInt32, embers: Bool, at t: Double, moving: Bool) -> (FieldOrb.Frame, Double) {
        courses.withLock { all in
            var course = all[key] ?? Course(motion: motion, clock: FieldOrb.clock(motion), last: t)
            course.motion = motion
            guard moving else {
                // (Its clock waits where it was: back in front, it carries on from there, not from far ahead.)
                course.last = t
                all[key] = course
                let still = FieldOrb.still(motion)
                return (FieldOrb.Frame(turn: course.clock.turn, glow: still.glow, rim: still.rim, embers: []), 0)
            }
            if t > course.last {
                course.clock = FieldOrb.step(course.clock, motion, t - course.last)
                course.last = t
            }
            all[key] = course
            return (FieldOrb.frame(course.clock, at: t, seed: seed, embers: embers), FieldOrb.fps(course.clock, motion))
        }
    }
}

/// Still orbs' pictures, the latest few dozen kept: a knight in twenty rows is drawn once.
final class FieldStills: Sendable {
    static let shared = FieldStills()
    private let kept = Mutex<(images: [String: CGImage], order: [String])>(([:], []))

    func image(identity: FieldIdentity, lance: Bool, knight: Bool, size: CGFloat, frame: FieldOrb.Frame, paper: Bool, scale: CGFloat) -> CGImage? {
        let key = "\(identity.seed)/\(identity.tilt)/\(identity.lines)/\(identity.colours.key)/\(identity.colours.rim)|\(lance)/\(knight)|\(frame.glow)/\(frame.rim)/\(frame.turn)|\(size)@\(scale)|\(paper)"
        if let image = kept.withLock({ $0.images[key] }) { return image }
        let px = Int((size * scale).rounded(.up))
        guard px > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
              let g = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        // Its own coordinates, as a canvas's: points, from the top left, y down.
        g.translateBy(x: 0, y: CGFloat(px))
        g.scaleBy(x: scale, y: -scale)
        FieldPainter.paint(g, size: size, identity: identity, galahad: !knight, lance: lance, frame: frame, paper: paper)
        guard let image = g.makeImage() else { return nil }
        kept.withLock { kept in
            if kept.images[key] == nil { kept.order.append(key) }
            kept.images[key] = image
            if kept.order.count > 64 { kept.images[kept.order.removeFirst()] = nil }
        }
        return image
    }
}

/// A frame of a field, drawn (ui/orb.ts' drawField): its lines turned as the frame says, as continuous strokes from point
/// to point, each in its light as the icon shows it (FieldOrb.tone), added to the others on a dark page with a close,
/// faint glow under them; on a light page, in ink. The strokes of one colour and brightness are one path, so a frame is a
/// few dozen strokes, not one for each point; his lance goes under the lines. Then his embers.
enum FieldPainter {
    /// How many steps of brightness (or of an ink's opacity) its strokes are drawn in, and of each colour channel.
    private static let levels = 16
    private static let hues = 16
    /// The camera Field.project places: 28 degrees across, 8.3 from the core.
    private static let focal = 1 / tan((14 * Double.pi) / 180)
    private static let distance = 8.3

    /// Each field's model and the buffer its points are written to, made once for each field and look.
    private static let models = Mutex<[String: (model: Field.Model, buffer: Field.Buffer)]>([:])

    /// `galahad`: his look (fewer of his lines where he is small; FieldOrb.look); `lance`: his lance through it.
    static func paint(_ g: CGContext, size: CGFloat, identity: FieldIdentity, galahad: Bool, lance: Bool, frame: FieldOrb.Frame, paper: Bool) {
        let look = FieldOrb.look(identity, size: Double(size), galahad: galahad)
        let colours = FieldOrb.colours(identity.colours, rim: frame.rim)
        let lightNow = colours == identity.colours ? nil : Field.light(colours)
        let modelKey = "\(identity.seed)/\(identity.tilt)/\(identity.colours.key)/\(identity.colours.rim)|\(look.lines)/\(look.steps)/\(look.weight)"
        let half = Double(size) / 2, f = half * focal * look.zoom
        let inks = paper ? FieldOrb.inks(colours) : nil
        let glow = max(0, frame.glow)
        let light = FieldOrb.strokeLight(Double(size))
        func q(_ v: Double, _ steps: Int) -> Int { max(0, min(steps - 1, Int(FieldOrb.jsRound(v * Double(steps - 1))))) }
        // Each kind of stroke's path, built from the points as they are placed.
        var paths: [Int: CGMutablePath] = [:]
        models.withLock { models in
            // (Taken out while its buffer is written, so the buffer is written in place rather than copied.)
            var made = models.removeValue(forKey: modelKey) ?? {
                let model = Field.model(lines: look.lines, steps: look.steps, tilt: identity.tilt, weight: look.weight, colours: identity.colours, seed: identity.seed)
                return (model, Field.Buffer(model))
            }()
            let count = Field.at(made.model, turn: frame.turn, into: &made.buffer, light: lightNow)
            let b = made.buffer
            var lastKind = -1, lastX = 0.0, lastY = 0.0, lastAt = Int.min
            var lastAdded: [Int: Int] = [:]
            for i in 0..<count {
                let depth = distance - b.z[i]
                let x = half + (b.x[i] * f) / depth, y = half - (b.y[i] * f) / depth
                var level: Double, r: Double, gg: Double, bb: Double
                if let inks {
                    let ink = FieldOrb.ink(inks, lit: b.lit[i], rim: b.rim[i])
                    (r, gg, bb) = (ink.rgb[0] / 255, ink.rgb[1] / 255, ink.rgb[2] / 255)
                    level = min(1, ink.alpha * glow)
                } else {
                    let toned = FieldOrb.tone(b.r[i] * glow * light, b.g[i] * glow * light, b.b[i] * glow * light)
                    // Its colour at full brightness, and how bright: so a stroke of one colour is drawn at a step of brightness.
                    level = max(toned.0, toned.1, toned.2)
                    let m = level == 0 ? 1 : level
                    (r, gg, bb) = (toned.0 / m, toned.1 / m, toned.2 / m)
                }
                let shown = q(level, levels)
                let kind = shown == 0 ? -1 : (((q(r, hues) << 8) | (q(gg, hues) << 4) | q(bb, hues)) << 4) | shown
                // Joined to the point before it on its line, in this point's stroke.
                if i > 0, b.at[i] == lastAt + 1, kind >= 0, lastKind >= 0 {
                    let path = paths[kind] ?? CGMutablePath()
                    if lastAdded[kind] != i - 1 { path.move(to: CGPoint(x: lastX, y: lastY)) }
                    path.addLine(to: CGPoint(x: x, y: y))
                    paths[kind] = path
                    lastAdded[kind] = i
                }
                (lastKind, lastX, lastY, lastAt) = (kind, x, y, b.at[i])
            }
            models[modelKey] = made
            if models.count > 48 { models.removeAll(keepingCapacity: true) }
        }
        g.saveGState()
        g.setLineCap(.round)
        g.setLineJoin(.round)
        g.setBlendMode(paper ? .normal : .plusLighter)
        let weight = look.weight
        let space = CGColorSpace(name: CGColorSpace.sRGB)
        func color(_ r: Double, _ gg: Double, _ b: Double, _ a: Double) -> CGColor {
            CGColor(colorSpace: space ?? CGColorSpaceCreateDeviceRGB(), components: [r, gg, b, a]) ?? CGColor(gray: 0, alpha: a)
        }
        for glowing in paper ? [false] : [true, false] {
            // His lance, under his lines (on a light page they cross over it; on a dark one light adds alike either way).
            if !glowing && lance { self.lance(g, size: Double(size), zoom: look.zoom, identity: identity, colours: colours, glow: glow, inks: inks, color: color) }
            for (kind, path) in paths {
                let level = Double(kind & 0xf) / Double(levels - 1)
                let hue = kind >> 4
                let channel = { (shift: Int) in Double((hue >> shift) & 0xf) / Double(hues - 1) }
                let width = (FieldOrb.Stroke.least + FieldOrb.Stroke.more * level) * weight * (paper ? FieldOrb.Stroke.ink : 1)
                g.setLineWidth(glowing ? width * FieldOrb.Stroke.glowWidth : width)
                g.setStrokeColor(color(channel(8), channel(4), channel(0), glowing ? level * FieldOrb.Stroke.glowAlpha : level))
                g.addPath(path)
                g.strokePath()
            }
        }
        if !frame.embers.isEmpty {
            let ember = paper ? FieldOrb.inks(colours).rim : emberLight(colours)
            for e in frame.embers where e.alpha >= 0.01 {
                let radius = max(0.6, e.r * half)
                let centre = CGPoint(x: half + e.x * half, y: half + e.y * half)
                if !paper {
                    g.setFillColor(color(ember[0] / 255, ember[1] / 255, ember[2] / 255, e.alpha * FieldOrb.Stroke.glowAlpha * 2))
                    g.fillEllipse(in: CGRect(x: centre.x - radius * 2.4, y: centre.y - radius * 2.4, width: radius * 4.8, height: radius * 4.8))
                }
                g.setFillColor(color(ember[0] / 255, ember[1] / 255, ember[2] / 255, min(1, e.alpha)))
                g.fillEllipse(in: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
            }
        }
        g.restoreGState()
    }

    /// An ember's colour on a dark page: its rim's, a third of the way to its key's deep gold.
    private static func emberLight(_ colours: FieldColours) -> [Double] {
        func rgb(_ hex: String) -> [Double] { [1, 3, 5].map { Double(Int(hex.dropFirst($0).prefix(2), radix: 16) ?? 0) } }
        let (a, b) = (rgb(colours.rim), rgb(colours.key[1]))
        return (0..<3).map { a[$0] + (b[$0] - a[$0]) / 3 }
    }

    /// His lance (FieldOrb.Lance, lanceLine, lanceAt; ui/orb.ts' lance): each half one blade, from its root out of his core
    /// to its tip, narrowing to a point and fading as it goes, filled along its length with his lit gold going to his gold
    /// and then his rim's copper (its light added, over a close glow), or on a light page his inks; as bright as his field
    /// is now (`glow`). One path and one fill a half and a pass, so no seam shows where light is added to light. Drawn in
    /// the blend the lines are (light added on a dark page).
    private static func lance(_ g: CGContext, size: Double, zoom: Double, identity: FieldIdentity, colours: FieldColours, glow: Double, inks: FieldOrb.Inks?, color: (Double, Double, Double, Double) -> CGColor) {
        let L = FieldOrb.Lance.self
        let half = size / 2
        // Half its width at its root, in points: never under half a point (a point across).
        let root = max(0.5, (size * L.width) / 2)
        let strength = min(1, max(0, glow))
        func rgb(_ hex: String) -> [Double] { [1, 3, 5].map { Double(Int(hex.dropFirst($0).prefix(2), radix: 16) ?? 0) } }
        func mix(_ a: [Double], _ b: [Double], _ t: Double) -> [Double] { (0..<3).map { FieldOrb.jsRound(a[$0] + (b[$0] - a[$0]) * t) } }
        let (lit, gold, rim) = (rgb(colours.key[0]), rgb(colours.key[1]), rgb(colours.rim))
        func colourAt(_ hue: Double) -> [Double] {
            if let inks { return mix(inks.key, inks.rim, hue) }
            return hue <= 0.5 ? mix(lit, gold, hue * 2) : mix(gold, rim, (hue - 0.5) * 2)
        }
        let stops = 8
        let space = CGColorSpace(name: CGColorSpace.sRGB)
        for blade in FieldOrb.lanceLine(identity, zoom: zoom) {
            let (x0, y0) = (half + blade.root[0] * half, half + blade.root[1] * half)
            let (x1, y1) = (half + blade.tip[0] * half, half + blade.tip[1] * half)
            let length = hypot(x1 - x0, y1 - y0)
            let along = length > 0 ? length : 1
            let (nx, ny) = (-(y1 - y0) / along, (x1 - x0) / along)
            for glowing in inks == nil ? [true, false] : [false] {
                let spread = glowing ? L.glowWidth : inks != nil ? L.inkWidth : 1
                let strong = strength * (glowing ? L.glowAlpha : inks != nil ? L.inkAlpha : 1)
                let colors = (0...stops).map { i -> CGColor in
                    let at = FieldOrb.lanceAt(Double(i) / Double(stops))
                    let c = colourAt(at.hue)
                    return color(c[0] / 255, c[1] / 255, c[2] / 255, FieldOrb.jsRound(min(1, at.light * strong) * 1000) / 1000)
                }
                let locations = (0...stops).map { CGFloat($0) / CGFloat(stops) }
                guard let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: locations) else { continue }
                // One side from root to tip, the other back: its width at each step its root's times lanceAt's share.
                let outline = CGMutablePath()
                for i in 0...L.steps {
                    let u = Double(i) / Double(L.steps), w = root * spread * FieldOrb.lanceAt(u).width
                    let point = CGPoint(x: x0 + (x1 - x0) * u + nx * w, y: y0 + (y1 - y0) * u + ny * w)
                    if i == 0 { outline.move(to: point) } else { outline.addLine(to: point) }
                }
                for i in stride(from: L.steps, through: 0, by: -1) {
                    let u = Double(i) / Double(L.steps), w = root * spread * FieldOrb.lanceAt(u).width
                    outline.addLine(to: CGPoint(x: x0 + (x1 - x0) * u - nx * w, y: y0 + (y1 - y0) * u - ny * w))
                }
                outline.closeSubpath()
                g.saveGState()
                g.addPath(outline)
                g.clip()
                g.drawLinearGradient(gradient, start: CGPoint(x: x0, y: y0), end: CGPoint(x: x1, y: y1), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
                g.restoreGState()
            }
        }
    }
}
