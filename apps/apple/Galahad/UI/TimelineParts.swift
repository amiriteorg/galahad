import SwiftUI

/// A timeline's title in its bar (Galahad's chat, a knight's, a room's): whose it is, and one line of where it stands
/// under it, in Galahad's red when it needs you. The line is always there, so the title doesn't move when it comes; the
/// bar gives the two the room between its buttons, and a long line ends in an ellipsis there.
struct TimelineTitle: View {
    let title: String
    let line: String?
    var needs = false

    var body: some View {
        VStack(spacing: 1) {
            Text(title).font(.headline).foregroundStyle(.primary)
            Text(line ?? " ")
                .font(.caption)
                .foregroundStyle(needs ? Color.siege : .secondary)
                .lineLimit(1)
        }
    }
}

/// What a timeline with nothing in it yet says: whose it is, its face, and what to do here.
struct TimelineWelcome<Face: View>: View {
    let title: String
    let words: String
    @ViewBuilder let face: Face

    var body: some View {
        VStack(spacing: Space.s3) {
            face
            Text(title).font(.title2.bold())
            Text(words)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Space.s10)
        .padding(.horizontal, Space.s6)
    }
}

/// Who is writing a reply now, under the speakers' faces' column, where the reply will be.
struct WritingLine: View {
    let words: String

    var body: some View {
        HStack(spacing: Space.s2) {
            ProgressView().controlSize(.mini)
            Text(words)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.leading, Metrics.speakerFace + Space.s2)
    }
}
