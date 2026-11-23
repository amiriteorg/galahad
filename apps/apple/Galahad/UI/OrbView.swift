import SwiftUI

/// Galahad as an orb (the PWA's ui/orb.ts): Orb's parts for its size, drawn in the colour of his state, the same in light
/// and dark. Still: a new state is a new colour. Decorative beside his name; named (`label`) where it stands alone.
struct GalahadOrb: View {
    var size: CGFloat = 36
    var tone: Orb.Tone = .neutral
    var label: String? = nil

    var body: some View {
        let parts = Orb.parts(Double(size))
        let palette = Orb.palette(tone)
        Canvas { context, canvas in
            context.translateBy(x: canvas.width / 2, y: canvas.height / 2)
            context.scaleBy(x: canvas.width / 200, y: canvas.height / 200)
            for part in parts { Self.draw(part.kind, palette, in: context) }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(label ?? "")
        .accessibilityAddTraits(.isImage)
        .accessibilityHidden(label == nil)
    }

    private static func draw(_ kind: Orb.Kind, _ palette: Orb.Palette, in context: GraphicsContext) {
        let ink = { (ink: Orb.Ink) -> Color in
            switch ink {
            case .tint: Color(hex: palette.tint)
            case .light: Color(hex: palette.light)
            case .deep: Color(hex: palette.deep)
            case .white: .white
            }
        }
        let gradient = { (stops: [Orb.Stop]) in Gradient(stops: stops.map { Gradient.Stop(color: ink($0.ink).opacity($0.opacity), location: $0.at) }) }
        let circle = { (r: Double) in Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r)) }
        switch kind {
        case let .disc(r, cx, cy, spread, stops):
            // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
            let center = CGPoint(x: -r + cx * 2 * r, y: -r + cy * 2 * r)
            context.fill(circle(r), with: .radialGradient(gradient(stops), center: center, startRadius: 0, endRadius: spread * 2 * r))
        case let .ring(r, width, color, opacity, arcs):
            var path = Path()
            if let arcs {
                for arc in arcs {
                    path.move(to: point(r, arc.from))
                    // (Degrees from the top, clockwise: the context's own angles start at three o'clock, y down.)
                    path.addArc(center: .zero, radius: r, startAngle: .degrees(arc.from - 90), endAngle: .degrees(arc.to - 90), clockwise: false)
                }
            } else {
                path = circle(r)
            }
            context.stroke(path, with: .color(ink(color).opacity(opacity)), style: StrokeStyle(lineWidth: width, lineCap: .butt))
        case let .ticks(r, count, offset, length, width, color, opacity):
            var path = Path()
            for i in 0..<count {
                let angle = offset + 360 * Double(i) / Double(count)
                path.move(to: point(r - length / 2, angle))
                path.addLine(to: point(r + length / 2, angle))
            }
            context.stroke(path, with: .color(ink(color).opacity(opacity)), style: StrokeStyle(lineWidth: width, lineCap: .butt))
        case let .rim(r, width, from, to, stops):
            context.stroke(circle(r), with: .linearGradient(gradient(stops), startPoint: CGPoint(x: from.x, y: from.y), endPoint: CGPoint(x: to.x, y: to.y)), lineWidth: width)
        case let .shine(cx, cy, rx, ry, rotate, opacity):
            var turned = context
            turned.translateBy(x: cx, y: cy)
            turned.rotate(by: .degrees(rotate))
            turned.fill(Path(ellipseIn: CGRect(x: -rx, y: -ry, width: 2 * rx, height: 2 * ry)), with: .color(.white.opacity(opacity)))
        }
    }

    /// The point `r` from the middle at `angle` degrees clockwise from the top (y down).
    private static func point(_ r: Double, _ angle: Double) -> CGPoint {
        let radians = angle * .pi / 180
        return CGPoint(x: r * sin(radians), y: -r * cos(radians))
    }
}
