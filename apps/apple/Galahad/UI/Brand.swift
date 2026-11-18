import SwiftUI

/*
 * Galahad's accents, and nothing more: his red for what needs you and for his seat, the cream ink and the black tile
 * (scripts/brand.ts writes them from apps/web/src/brand.ts), the Roundtable's mark, and the knights as the owner drew
 * them; and the one scale every screen is spaced on. Everything else is the system's own.
 */

/// The app's one spacing scale: the PWA's (`--sp-*` in apps/web/src/index.html; each step named as there), in points.
/// Every gap, margin and padding is one of these, so the same thing is spaced the same way wherever it is.
enum Space {
    /// Between the lines of one thing: a name and the line under it.
    static let line: CGFloat = 2
    static let s1: CGFloat = 4
    static let s2: CGFloat = 8
    static let s3: CGFloat = 12
    static let s4: CGFloat = 16
    static let s6: CGFloat = 24
    static let s10: CGFloat = 40
}

/// What the screens share beyond the scale: a page's margins, the faces' sizes, and the corners of what sits on a page.
enum Metrics {
    /// A page's side margins, and the space between the items of a timeline.
    static let margin = Space.s4
    /// A face in a row of the Roundtable: Galahad's, a knight's, a room's members'.
    static let rowFace: CGFloat = 56
    /// What the ring round a face at the Roundtable takes of each side, its stroke and the gap inside it: in a row, and
    /// on a card.
    static let rowRing = Space.s1
    static let cardRing = Space.s2
    /// The column the faces of the Roundtable's rows stand in, ring and all, so every name starts at one edge.
    static let rowSeat = rowFace + 2 * rowRing
    /// A face on a card of the Roundtable: large enough for its eyes to follow its work (`KnightEyes.wandersFrom`).
    static let cardFace: CGFloat = 104
    /// The narrowest a card of the Roundtable is: its face in its ring, and room either side.
    static let cardWidth = cardFace + 2 * cardRing + 2 * Space.s4
    /// A speaker's face beside what it said.
    static let speakerFace: CGFloat = 32
    /// What your bubble leaves free at its side: a speaker's face and its gap, and the room a reply leaves at the other
    /// side, so a bubble of yours is never wider than one of theirs.
    static let yoursInset = speakerFace + Space.s2 + Space.s6
    /// The face that welcomes you to a timeline with nothing in it yet.
    static let welcomeFace: CGFloat = 120
    /// The column an icon stands in beside its words, so the words start at one edge whatever the icon.
    static let iconColumn: CGFloat = 28
    /// The smallest a thing to tap is, and the height of a field beside a button (Apple's 44 points).
    static let touch: CGFloat = 44
    /// The corners of a bubble and of a card in a timeline.
    static let cardRadius: CGFloat = 20
    /// The corners of what sits inside one (code, figures, a page, a screen), and of a field.
    static let innerRadius: CGFloat = 12
    /// What a bubble's words keep from its edges (Messages' own); a card keeps `Space.s3` all round, so the words of
    /// both start the same distance in.
    static let bubblePadding = EdgeInsets(top: Space.s2, leading: Space.s3, bottom: Space.s2, trailing: Space.s3)
}

extension Color {
    /// The ink, the app's accent: the black tile on light, the cream on dark. Set as the tint at the root, since the
    /// system's controls took system blue from the asset catalog's accent alone (seen on iOS 26.1).
    static let ink = Color(.accent)
    /// Galahad's red: what needs you, and his seat at the Round Table.
    static let siege = Color(.siege)
    /// What is written on the ink (the accent): cream on the black tile, black on the cream.
    static let onAccent = Color(.onAccent)
    static let tile = Color(.tile)
    static let cream = Color(.cream)
}

/// The owner's drawings of the knights, from the app's bundle by fixed names (apps/web/src/knights, bundled as they
/// are). Nothing from the node reaches a file name: a knight's look is one of ten known names.
@MainActor enum Drawings {
    private static var kept: [String: PlatformImage] = [:]
    /// The drawings that come at twice the size too, for showing big.
    private static let large: Set<String> = ["galahad", "black-knight"]

    static func image(_ name: String, large wantLarge: Bool) -> PlatformImage? {
        let file = wantLarge && large.contains(name) ? "\(name)@2x" : name
        if let image = kept[file] { return image }
        guard let path = Bundle.main.path(forResource: file, ofType: "webp", inDirectory: "knights"), let image = PlatformImage(contentsOfFile: path) else { return nil }
        kept[file] = image
        return image
    }
}

/// A knight as the owner drew it: the drawing exactly, with nothing drawn round it. Given what it is doing, its eyes
/// are live (KnightEyes): they blink, look and change with its state, and nothing else of the drawing moves. Without,
/// it is still: a speaker in a conversation's history keeps no state of its own.
struct Portrait: View {
    /// `galahad`, or the look `AvatarLook` chose.
    let drawing: String
    var size: CGFloat = 48
    /// What it is doing (KnightEyes.shown's states); nil: still.
    var expression: String? = nil
    /// Its handle, for its own moment in the blink.
    var id = ""
    /// How lively it is at rest: calm, curious or lively.
    var temper = "calm"

    var body: some View {
        Group {
            if let image = Drawings.image(drawing, large: size >= 120) {
                Image(platformImage: image).resizable().interpolation(.high).scaledToFit()
                    // Paused, its colour is drained, as on the PWA.
                    .saturation(expression == "resting" ? 0.15 : 1)
                    .opacity(expression == "resting" ? 0.62 : 1)
                    .overlay {
                        if let expression, KnightEyes.art[drawing] != nil {
                            LiveEyes(art: drawing, expression: expression, size: size, beat: KnightEyes.beat(id.isEmpty ? drawing : id), temper: temper)
                        }
                    }
            } else {
                Image(systemName: "person.crop.circle").resizable().scaledToFit().foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A drawing's two eyes, live: each drawn eye covered in its slit's own dark, and drawn again as the state has it, at
/// the place its gaze puts it, blinking at the knight's own moment. Drawn a frame at a time while on screen; still when
/// the device asks for reduced motion.
struct LiveEyes: View {
    let art: String
    let expression: String
    let size: CGFloat
    let beat: Int
    let temper: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(EyeFrames(moments: KnightEyes.moments(expression: expression, temper: temper, beat: beat, size: size), still: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
            Canvas { canvas, box in
                draw(in: &canvas, scale: box.width / KnightEyes.canvas, t: t)
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
    }

    private func draw(in canvas: inout GraphicsContext, scale k: Double, t: Double) {
        guard let eyes = KnightEyes.art[art], let shown = KnightEyes.shown[expression] else { return }
        let blink = KnightEyes.blinks(expression) && !reduceMotion ? KnightEyes.blink(at: t, beat: beat) : 1
        let moved = reduceMotion || size < KnightEyes.wandersFrom ? (x: 0.0, y: 0.0) : KnightEyes.gaze(at: t, expression: expression, temper: temper, beat: beat)
        for eye in eyes {
            let r = eye.r * k
            // The drawn eye, covered in the dark of its own slit.
            canvas.fill(Path(ellipseIn: CGRect(x: eye.x * k - 1.3 * r, y: eye.y * k - 1.3 * r, width: 2.6 * r, height: 2.6 * r)), with: .color(Color(hex: eye.slit)))
            let cx = eye.x * k + shown.gaze.x * r + moved.x * k
            let cy = eye.y * k + shown.gaze.y * r + moved.y * k
            var eyeContext = canvas
            // A blink shuts it about its own middle.
            eyeContext.translateBy(x: cx, y: cy)
            eyeContext.scaleBy(x: 1, y: blink)
            switch shown.eyes {
            case .happy:
                var arc = Path()
                arc.move(to: CGPoint(x: -1.1 * r, y: 0.42 * r))
                arc.addQuadCurve(to: CGPoint(x: 1.1 * r, y: 0.42 * r), control: CGPoint(x: 0, y: -1.15 * r))
                eyeContext.stroke(arc, with: .color(.white), style: StrokeStyle(lineWidth: 0.62 * r, lineCap: .round))
            case .shut:
                var arc = Path()
                arc.move(to: CGPoint(x: -1.1 * r, y: 0))
                arc.addQuadCurve(to: CGPoint(x: 1.1 * r, y: 0), control: CGPoint(x: 0, y: 0.8 * r))
                eyeContext.stroke(arc, with: .color(.white), style: StrokeStyle(lineWidth: 0.55 * r, lineCap: .round))
            case .ember:
                for (radius, color, opacity) in [(2.3, "#ff3b4e", 0.16), (1.6, "#ff3b4e", 0.32), (1.12, "#ff4a5a", 1), (0.55, "#fff1f2", 1)] {
                    eyeContext.fill(Path(ellipseIn: CGRect(x: -radius * r, y: -radius * r, width: 2 * radius * r, height: 2 * radius * r)), with: .color(Color(hex: color).opacity(opacity)))
                }
            case .open, .wide, .low:
                let size = shown.eyes == .wide ? 1.18 : shown.eyes == .low ? 0.86 : 1
                let drop = shown.eyes == .low ? 0.12 * r : 0
                eyeContext.fill(Path(ellipseIn: CGRect(x: -size * r, y: drop - size * r, width: 2 * size * r, height: 2 * size * r)), with: .color(.white))
            }
        }
    }
}

/// The frames live eyes are drawn at: 30 a second through a blink or a glance and none between (a blink every few
/// seconds asks for a handful), and 12 a second for eyes that follow the work, which move all the time.
struct EyeFrames: TimelineSchedule {
    let moments: [(period: Double, offset: Double, from: Double, to: Double)]?
    let still: Bool

    func entries(from start: Date, mode: TimelineScheduleMode) -> AnyIterator<Date> {
        var next = start
        var first = true
        return AnyIterator {
            if first { first = false; return next }
            if still { return nil }
            // Eyes that follow the work drift slowly (a third of an eye in half a second): a dozen frames a second
            // draw that as smoothly as thirty, for less than half the work. A blink is quick, and gets thirty.
            let step = mode == .lowFrequency ? 1.0 : moments == nil ? 1.0 / 12 : 1.0 / 30
            let t = next.timeIntervalSinceReferenceDate + step
            guard let moments else { next = Date(timeIntervalSinceReferenceDate: t); return next }
            guard let move = KnightEyes.nextMove(after: t, in: moments) else { return nil }
            // At rest the eyes are drawn open again once, then not until they next move.
            next = Date(timeIntervalSinceReferenceDate: move)
            return next
        }
    }
}

extension Color {
    /// A colour from its six hex digits (the drawings' own slits; nothing from a profile).
    init(hex: String) {
        let value = Int(hex.dropFirst(), radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }

    /// One colour on light, another on dark (the PWA's `light-dark()`), by six hex digits each.
    init(light: String, dark: String) {
        func rgb(_ hex: String) -> (Double, Double, Double) {
            let value = Int(hex.dropFirst(), radix: 16) ?? 0
            return (Double((value >> 16) & 0xff) / 255, Double((value >> 8) & 0xff) / 255, Double(value & 0xff) / 255)
        }
        let (l, d) = (rgb(light), rgb(dark))
        #if os(iOS)
        self.init(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: d.0, green: d.1, blue: d.2, alpha: 1) : UIColor(red: l.0, green: l.1, blue: l.2, alpha: 1) })
        #else
        self.init(NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(red: d.0, green: d.1, blue: d.2, alpha: 1) : NSColor(red: l.0, green: l.1, blue: l.2, alpha: 1) })
        #endif
    }
}

extension Highlight.Tone {
    /// Its colour, light and dark (the PWA's .tok-* and --code-*): a language's words in the cross's red, quiet blues for
    /// what code holds, comments receding; a diff's lines in green and red.
    var color: Color {
        switch self {
        case .keyword: Color(light: "#b3261e", dark: "#ff8a80")
        case .string: Color(light: "#0a3069", dark: "#a5d6ff")
        case .number: Color(light: "#0550ae", dark: "#79c0ff")
        case .comment: Color(light: "#6e7781", dark: "#8b949e")
        case .added: Color(light: "#116329", dark: "#7ee2a8")
        case .removed: Color(light: "#82071e", dark: "#ffa198")
        case .meta: .secondary
        }
    }

    /// A diff's line, under its words.
    var shade: Color? {
        switch self {
        case .added: Color(light: "#dafbe1", dark: "#1d3a26")
        case .removed: Color(light: "#ffebe9", dark: "#3d1f20")
        default: nil
        }
    }
}

extension Highlight {
    /// Code as one attributed string in its colours (the PWA's ui/markdown.ts codeBlock).
    static func attributed(_ code: String, lang: String) -> AttributedString {
        var out = AttributedString()
        for piece in pieces(code, lang: lang) {
            var part = AttributedString(piece.text)
            if let tone = piece.tone {
                part.foregroundColor = tone.color
                if let shade = tone.shade { part.backgroundColor = shade }
                if tone == .comment { part.inlinePresentationIntent = .emphasized }
                if tone == .meta { part.inlinePresentationIntent = .stronglyEmphasized }
            }
            out += part
        }
        return out
    }
}

/// The Roundtable from above: the ring and the knights' chairs in the ink, Galahad's seat in his red.
struct RoundtableMark: View {
    var size: CGFloat = 28

    var body: some View {
        Image(.roundtable).resizable().scaledToFit().frame(width: size, height: size).accessibilityLabel("The Roundtable")
    }
}

/// The app's icon, as the app draws it: the Roundtable in black on the white tile, Galahad's seat in red, as appIcon()
/// seats it, with appIcon()'s faint dark edge (a pixel wide here), which keeps the white tile apart from a white page.
struct AppTile: View {
    var size: CGFloat = 88
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
                .fill(.white)
                .strokeBorder(.black.opacity(0.1), lineWidth: 1 / displayScale)
            Image(.roundtable).resizable().scaledToFit().padding(size * 0.11).environment(\.colorScheme, .light)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

extension View {
    /// A field outside a form (a key to seal, text for a knight's screen): the system's quiet fill, the corners of what
    /// sits inside a card, and a thumb's height. Beside a button, the row is made as tall as its tallest, so the two match.
    func quietField() -> some View {
        plainField()
            .padding(.horizontal, Space.s3)
            .frame(minHeight: Metrics.touch)
            .background(.fill.tertiary, in: .rect(cornerRadius: Metrics.innerRadius, style: .continuous))
    }
}

/// The mark on what needs you.
struct NeedsMark: View {
    var body: some View {
        Circle().fill(Color.siege).frame(width: 10, height: 10).accessibilityLabel("Needs you")
    }
}

/// Something at work, said without motion (the owner's word: nothing in a state spins): a small dot in its colour with
/// a soft halo, the PWA's still "live" dot. The words beside it say what is going on.
struct LiveDot: View {
    var color: Color = .ink

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 6, height: 6)
            .padding(Space.line)
            .background(color.opacity(0.22), in: .circle)
            .accessibilityHidden(true)
    }
}
