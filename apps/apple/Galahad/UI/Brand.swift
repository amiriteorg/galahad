import SwiftUI
import UIKit

/*
 * Galahad's accents, and nothing more: his red for what needs you and for his seat, the cream ink and the black tile
 * (scripts/brand.ts writes them from apps/web/src/brand.ts), the Roundtable's mark, and the knights as the owner drew
 * them. Everything else is the system's own.
 */

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
    private static var kept: [String: UIImage] = [:]
    /// The drawings that come at twice the size too, for showing big.
    private static let large: Set<String> = ["galahad", "black-knight"]

    static func image(_ name: String, large wantLarge: Bool) -> UIImage? {
        let file = wantLarge && large.contains(name) ? "\(name)@2x" : name
        if let image = kept[file] { return image }
        guard let path = Bundle.main.path(forResource: file, ofType: "webp", inDirectory: "knights"), let image = UIImage(contentsOfFile: path) else { return nil }
        kept[file] = image
        return image
    }
}

/// A knight as the owner drew it: the drawing exactly, still, with nothing drawn round it.
struct Portrait: View {
    /// `galahad`, or the look `AvatarLook` chose.
    let drawing: String
    var size: CGFloat = 48

    var body: some View {
        Group {
            if let image = Drawings.image(drawing, large: size >= 120) {
                Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
            } else {
                Image(systemName: "person.crop.circle").resizable().scaledToFit().foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The Roundtable from above: the ring and the knights' chairs in the ink, Galahad's seat in his red.
struct RoundtableMark: View {
    var size: CGFloat = 28

    var body: some View {
        Image(.roundtable).resizable().scaledToFit().frame(width: size, height: size).accessibilityLabel("The Roundtable")
    }
}

/// The app's icon, as the app draws it: the Roundtable on the black tile, as appIcon() seats it, with appIcon()'s faint
/// white edge (a pixel wide here), which keeps the tile apart from a black page.
struct AppTile: View {
    var size: CGFloat = 88
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
                .fill(Color.tile)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1 / displayScale)
            Image(.roundtable).resizable().scaledToFit().padding(size * 0.11).environment(\.colorScheme, .dark)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The mark on what needs you.
struct NeedsMark: View {
    var body: some View {
        Circle().fill(Color.siege).frame(width: 10, height: 10).accessibilityLabel("Needs you")
    }
}
