import SwiftUI

/*
 * Galahad, the one you talk to (your word, 23 November 2026: for nearly everything, "a Jarvis … like visual, the orb
 * graphic"): his orb large in the colour of his state, what he is doing, what he asks you, your chats with him, and the
 * message box. On an iPhone it is the app's first tab and where it opens, each conversation shown over it as Messages
 * shows one; a new chat's welcome shows him the same way everywhere (ChatView). The knights are a tab away.
 */

extension EnvironmentValues {
    /// Shows the Inbox: the iPhone's tab, or the window's place.
    @Entry var showInbox: (() -> Void)? = nil
    /// Shows Galahad's own tab (an iPhone's): his row at the Roundtable leads there rather than to a page of its own.
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

#if os(iOS)
/// An iPhone's home, its first tab: Galahad himself, and the message box. What you send there starts a chat with him,
/// shown over it (`talk`); a chat of yours opens there too.
struct GalahadHome: View {
    let session: Session
    /// Shows the chat on screen over the home.
    let talk: () -> Void
    @FocusState private var composing: Bool
    @State private var away: AwayView?
    @State private var chats: [ConversationSummary]?
    @State private var listing = false

    private var chat: ChatModel { session.chat }

    var body: some View {
        ScrollView {
            VStack(spacing: Space.s6) {
                GalahadHero(tone: session.galahadTone, mood: session.galahadMood, title: "Galahad", line: session.galahad.text, lineColor: lineColor, size: 196)
                    .padding(.top, Space.s3)
                // His line from the Roundtable this iPhone kept, or a node that can't be reached: said here, as at the
                // Roundtable, so what the home shows is never taken for what the node says now.
                if let trouble = session.trouble {
                    TroubleRow(trouble: trouble).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                }
                if let since = session.keptSince { KeptLine(since: since) }
                Suggestions { text in
                    chat.draft = text
                    composing = true
                }
                if let away, !away.lines.isEmpty {
                    AwayCard(away: away) {
                        session.markAwaySeen()
                        self.away = nil
                    }
                }
                GalahadAsks(session: session)
                recent
            }
            .padding(.horizontal, Metrics.margin)
            .padding(.bottom, Space.s4)
            .readingWidth()
        }
        .scrollDismissesKeyboard(.interactively)
        // Cards and their words scroll under the message box: they fade out of the way there rather than show through it.
        .scrollEdgeEffectStyle(.hard, for: .bottom)
        // A bar of its own, so the edge it makes is the scroll view's.
        .safeAreaBar(edge: .bottom) {
            if chat.answering {
                answering
            } else {
                Composer(chat: chat, client: session.client, composing: $composing, sent: talk)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { listing = true } label: { Label("Chats", systemImage: "clock.arrow.circlepath") }
                    .accessibilityIdentifier("chats")
            }
        }
        .sheet(isPresented: $listing) {
            ChatsView(session: session) { id in
                listing = false
                open(id)
            } startNew: {
                listing = false
                composing = true
            }
        }
        // Back here, the next message starts a chat of its own (the one you left stays on your node, under Recent), and
        // the keyboard waits for you to ask for it.
        .onAppear {
            composing = false
            if !chat.answering { chat.startNew() }
        }
        .task {
            away = await session.away()
            await loadChats()
        }
        .task(id: session.unreadChats.map(\.id)) { await loadChats() }
        .refreshable {
            await session.refresh()
            await loadChats()
        }
    }

    /// His line's colour: amber while something waits on you, as everywhere.
    private var lineColor: Color {
        switch session.galahadTone {
        case .warn: .needs
        case .accent: .working
        case .ok: .done
        case .danger: .failed
        case .neutral: .secondary
        }
    }

    /// While he answers in the chat you left, the message box is that chat's: a press shows it.
    private var answering: some View {
        Button(action: talk) {
            HStack(spacing: Space.s2) {
                LiveDot(color: .working)
                Text(chat.title.map { "Answering in “\($0)”" } ?? "Answering").lineLimit(1)
                Spacer(minLength: Space.s2)
                Text("Show").fontWeight(.semibold)
            }
            .font(.subheadline)
            .padding(.horizontal, Space.s4)
            .frame(minHeight: Metrics.touch)
        }
        .buttonStyle(.glass)
        .padding(.horizontal, Metrics.margin)
        .padding(.vertical, Space.s2)
        .accessibilityIdentifier("answering")
    }

    /// Your latest chats with him, newest first, and the way to all of them.
    @ViewBuilder private var recent: some View {
        let latest = (chats ?? []).sorted { $0.updatedAt > $1.updatedAt }.prefix(4)
        if !latest.isEmpty {
            VStack(alignment: .leading, spacing: Space.s2) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Recent").font(.headline)
                    Spacer()
                    Button("All Chats") { listing = true }.font(.subheadline)
                }
                VStack(spacing: 0) {
                    ForEach(Array(latest.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider().padding(.leading, Space.s3) }
                        Button { open(item.id) } label: {
                            ChatRow(chat: item, group: Chats.groups([item]).first?.label ?? "", current: false)
                                .padding(.horizontal, Space.s3)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, Space.s1)
                .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
            }
        }
    }

    private func open(_ id: String) {
        Task {
            await chat.open(id, with: session.client)
            talk()
        }
    }

    private func loadChats() async {
        struct Listed: Decodable { let conversations: [ConversationSummary] }
        if let listed = try? await session.client.get("/api/conversations", as: Listed.self) { chats = listed.conversations }
    }
}

/// His orb as an iPhone's tab shows it: drawn once for each state and each colour scheme (on a light bar his glyphs are
/// ink on paper), in its own colours rather than the bar's.
@MainActor enum OrbIcon {
    private static var kept: [String: Image] = [:]

    static func image(_ tone: Orb.Tone, _ scheme: ColorScheme) -> Image {
        let key = "\(tone.rawValue) \(scheme == .light ? "light" : "dark")"
        if let image = kept[key] { return image }
        let renderer = ImageRenderer(content: GalahadOrb(size: 26, tone: tone).environment(\.colorScheme, scheme))
        renderer.scale = 3
        // (Its colours kept by the image itself: the bar tints an image SwiftUI marks original all the same.)
        let image = renderer.uiImage.map { Image(uiImage: $0.withRenderingMode(.alwaysOriginal)) } ?? Image(systemName: "circle.circle.fill")
        kept[key] = image
        return image
    }
}
#endif
