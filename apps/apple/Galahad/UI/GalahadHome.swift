import SwiftUI

/*
 * Galahad, the one you talk to (your word, 23 November 2026: for nearly everything, "a Jarvis … like visual, the orb
 * graphic"): his orb large, what he is doing, what he asks you, and what you might ask him first, as a new chat's welcome
 * shows him everywhere (ChatView). Home (HomeView.swift) is where the app opens.
 */

extension EnvironmentValues {
    /// Shows the Inbox: over an iPhone's Home, or as the window's place.
    @Entry var showInbox: (() -> Void)? = nil
    /// Shows Galahad's own conversation (an iPhone's, over Home): his row at the Roundtable leads there.
    @Entry var showGalahad: (() -> Void)? = nil
}

extension Session {
    /// The colour his orb shows: where he stands.
    var galahadTone: Orb.Tone { Orb.Tone(galahadStanding) }
    /// How his orb moves (your word, 24 November 2026: "pulsing/moving when doing a task, sitting idle, waiting, done"):
    /// where he stands, at work while he answers here.
    var galahadMood: Orb.Mood { Orb.Mood(galahadStanding) }
}

/// Galahad as you come to him: his orb large, moving as he is, a title, and a line under it.
struct GalahadHero: View {
    let tone: Orb.Tone
    var mood: Orb.Mood? = nil
    let title: String
    let line: String
    var lineColor: Color = .secondary
    var size: CGFloat = 184

    var body: some View {
        VStack(spacing: Space.s2) {
            GalahadOrb(size: size, tone: tone, mood: mood)
                .padding(.bottom, Space.s2)
            Text(title).font(.title2.bold())
            Text(line)
                .font(.subheadline)
                .foregroundStyle(lineColor)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// What you might ask him first (the PWA's welcome's own): a press puts it in the message box, to send as it is or change.
struct Suggestions: View {
    let fill: (String) -> Void

    static let all: [(title: String, text: String)] = [
        ("Catch me up", "What has my fleet been doing today, and does anything need me?"),
        ("Plan", "Plan this week's work on Galahad as a short, ordered list."),
        ("Recall", "What do we remember about how the fleet is deployed?"),
        ("Place", "Which of my machines should run a long build, and why?"),
    ]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: Space.s2), GridItem(.flexible(), spacing: Space.s2)], spacing: Space.s2) {
            ForEach(Self.all, id: \.title) { item in
                Button { fill(item.text) } label: {
                    Text(item.title).font(.subheadline.weight(.medium)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .accessibilityHint(item.text)
            }
        }
    }
}

/// What Galahad asks you, answered where you talk to him (the PWA's views/galahad-asks.ts): the approvals the oath leaves
/// to you (his and the knights', each saying who asked), the keys he asked for, and what services ask you in the middle
/// of his calls, each as the Inbox has it. At most four; the rest are counted, a press from the Inbox, which still holds
/// everything else (devices asking to join, facts, notices).
struct GalahadAsks: View {
    let session: Session
    @Environment(\.showInbox) private var showInbox
    @State private var open: ActionView?

    private static let shown = 4

    private enum Ask: Identifiable {
        case approval(ActionView)
        case key(SecretRequestView)
        case question(QuestionView)

        var id: String {
            switch self {
            case .approval(let action): "action:\(action.id)"
            case .key(let request): "key:\(request.id)"
            case .question(let question): "question:\(question.id)"
            }
        }
    }

    private var asks: [Ask] {
        session.waiting.map(Ask.approval) + session.requests.map(Ask.key) + session.questions.filter { $0.expires > Date.now.timeIntervalSince1970 * 1000 }.map(Ask.question)
    }

    var body: some View {
        let asks = asks
        if !asks.isEmpty {
            VStack(alignment: .leading, spacing: Space.s2) {
                Text("Galahad asks you").font(.headline)
                ForEach(asks.prefix(Self.shown)) { ask in
                    Group {
                        switch ask {
                        case .approval(let action):
                            Button { open = action } label: { ApprovalRow(action: action) }.buttonStyle(.plain)
                        case .key(let request):
                            KeyRequestRow(session: session, request: request)
                        case .question(let question):
                            QuestionRow(session: session, question: question)
                        }
                    }
                    .padding(Space.s3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
                }
                if asks.count > Self.shown {
                    Button("\(asks.count - Self.shown) more in the Inbox") { showInbox?() }
                        .font(.subheadline)
                        .disabled(showInbox == nil)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .sheet(item: $open) { action in ApprovalSheet(session: session, action: action) }
        }
    }
}

/// A new chat's welcome, wherever you start one: him, what you might ask, and what he asks you.
struct GalahadWelcome: View {
    let session: Session
    let fill: (String) -> Void

    var body: some View {
        VStack(spacing: Space.s6) {
            GalahadHero(tone: session.galahadTone, mood: session.galahadMood, title: "At your service.", line: "Ask anything. Galahad recalls what your fleet remembers, and uses his tools. Keys belong in the vault, never here.", size: 168)
            Suggestions(fill: fill)
            GalahadAsks(session: session)
        }
        .padding(.top, Space.s6)
    }
}

