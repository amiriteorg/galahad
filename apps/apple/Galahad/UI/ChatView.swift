import SwiftUI

/// Galahad's chat: your messages and his answers as bubbles, his streaming in as it comes, and the message box on the
/// keyboard. A new chat keeps the one before it on the node.
struct ChatView: View {
    let session: Session
    /// The chat shown, when it isn't the session's (on a Mac, one of his chats in a window of its own).
    private let shown: ChatModel?
    @FocusState private var composing: Bool
    @State private var listing = false
    /// His own computer, watched from here: its screen, or its terminal.
    @State private var watching = false
    @State private var inTerminal = false
    @Environment(\.composerWanted) private var composerWanted

    init(session: Session, chat: ChatModel? = nil) {
        self.session = session
        shown = chat
    }

    private var chat: ChatModel { shown ?? session.chat }
    private var latestAnswer: Int? { chat.thread.turns.last { $0.role == .assistant }?.id }

    var body: some View {
        ScrollView {
            // A plain stack: an answer's rows are tall and hold sideways-scrolling code and tables, and a lazy stack
            // pinned to the bottom kept placing them again and never settled (seen in the iOS 26.1 simulator).
            VStack(alignment: .leading, spacing: Metrics.margin) {
                if chat.thread.isEmpty {
                    if chat.loading { ProgressView().frame(maxWidth: .infinity).padding(.top, Space.s10) } else { welcome }
                }
                if let problem = chat.problem {
                    Label("This chat couldn't be read: \(problem)", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.siege)
                }
                ForEach(chat.thread.turns) { turn in
                    MessageRow(
                        turn: turn,
                        client: session.client,
                        reply: { chat.quote($0); composing = true },
                        edit: turn.role == .user && !chat.answering ? { chat.edit($0); composing = true } : nil,
                        askAgain: turn.id == chat.thread.turns.last?.id && chat.canAskAgain ? { chat.askAgain(with: session.client) } : nil
                    )
                        .environment(\.answerLive, turn.status == .streaming)
                        // Choices he offered are yours to tap on his latest finished answer only.
                        .environment(\.choose, turn.id == latestAnswer && turn.status == .done && !chat.answering ? { text in chat.reply(text, with: session.client) } : nil)
                }
            }
            .padding(.horizontal, Metrics.margin)
            .padding(.vertical, Space.s3)
            .readingWidth()
        }
        .keepingLatest()
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            Composer(chat: chat, client: session.client, composing: $composing)
        }
        .navigationTitle("Galahad")
        .inlineTitle()
        // A conversation has the screen to itself, as in Messages.
        .hidingTabBar()
        #if os(macOS)
        // On a Mac, the window's own title and its subtitle.
        .navigationSubtitle(chat.title ?? session.galahad.text)
        #endif
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .principal) {
                TimelineTitle(title: "Galahad", line: chat.title ?? session.galahad.text, needs: chat.title == nil && session.galahad.tone == .warn)
            }
            #endif
            ToolbarItemGroup(placement: .barTrailing) {
                // His own computer, once he has one (made from the web app or a terminal, as a knight's VM is).
                if session.team?.computer != nil && session.can("sandbox") {
                    Menu {
                        Button { watching = true } label: { Label("His screen", systemImage: "display") }
                        Button { inTerminal = true } label: { Label("His terminal", systemImage: "apple.terminal") }
                    } label: {
                        Label("His computer", systemImage: "desktopcomputer")
                    }
                    .accessibilityIdentifier("computer")
                }
                Button {
                    listing = true
                } label: {
                    Label("Chats", systemImage: "clock.arrow.circlepath")
                }
                .accessibilityIdentifier("chats")
                Button {
                    chat.startNew()
                    composing = true
                } label: {
                    Label("New chat", systemImage: "square.and.pencil")
                }
                .disabled(chat.answering || chat.thread.isEmpty)
            }
        }
        .navigationDestination(isPresented: $watching) {
            if let computer = session.team?.computer { KnightScreenView(session: session, knight: VMSeat(computer: computer)) }
        }
        .cover(isPresented: $inTerminal) {
            if let computer = session.team?.computer { KnightTerminalView(session: session, knight: VMSeat(computer: computer)) }
        }
        .sheet(isPresented: $listing) {
            ChatsView(session: session) { id in
                listing = false
                Task { await chat.open(id, with: session.client) }
            } startNew: {
                listing = false
                chat.startNew()
                composing = true
            }
        }
        .task { await chat.openLatest(with: session.client) }
        // A new chat asked for from the menus (⌘N, a Mac's or an iPad's): the message box takes the keys.
        .task(id: composerWanted.wrappedValue) {
            guard composerWanted.wrappedValue else { return }
            composerWanted.wrappedValue = false
            composing = true
        }
    }

    private var welcome: some View {
        TimelineWelcome(title: "Ask Galahad", words: "He answers with his tools at hand, within what this device may do. What you say here is kept on your node.") {
            Portrait(drawing: "galahad", size: Metrics.welcomeFace, expression: chat.answering ? "thinking" : "idle", id: "galahad")
        }
    }
}

/// One message: yours on the right in the ink, his on the left beside his drawing, with what he did above it.
struct MessageRow: View {
    let turn: ChatThread.Turn
    /// Where a picture you attached is read from, to show it (nil: shown only once it is known here).
    var client: NodeClient? = nil
    /// What holding it offers beyond copying and sharing (MessageMenu): quoting it, editing yours, asking his again.
    var reply: ((String) -> Void)? = nil
    var edit: ((String) -> Void)? = nil
    var askAgain: (() -> Void)? = nil

    var body: some View {
        switch turn.role {
        case .user:
            VStack(alignment: .trailing, spacing: Space.s2) {
                // What it carried, above its words (a message may be files alone).
                if let refs = turn.attachments, !refs.isEmpty { AttachedView(refs: refs, client: client) }
                if !turn.content.isEmpty {
                    HStack {
                        Spacer(minLength: Metrics.yoursInset)
                        Text(turn.content)
                            .foregroundStyle(Color.onAccent)
                            .padding(Metrics.bubblePadding)
                            .background(Color.ink, in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
                            .messageMenu(turn.content, reply: reply, edit: edit)
                    }
                }
            }
        case .assistant:
            HStack(alignment: .top, spacing: Space.s2) {
                Portrait(drawing: "galahad", size: Metrics.speakerFace)
                VStack(alignment: .leading, spacing: Space.s2) {
                    ForEach(Array(turn.steps.enumerated()).filter { $0.element.tool != nil }, id: \.offset) { _, step in
                        Label(step.text, systemImage: step.state == .active ? "gearshape" : step.state == .done ? "checkmark.circle" : "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(step.state == .warn || step.state == .error ? Color.siege : .secondary)
                    }
                    if !turn.content.isEmpty {
                        MarkdownView(turn.content)
                            .padding(Metrics.bubblePadding)
                            .background(.fill.tertiary, in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
                            .messageMenu(turn.content, reply: reply, askAgain: turn.status == .streaming ? nil : askAgain)
                            .accessibilityIdentifier("galahad-answer")
                    }
                    footer
                }
                Spacer(minLength: Space.s6)
            }
        }
    }

    @ViewBuilder private var footer: some View {
        switch turn.status {
        case .streaming:
            HStack(spacing: Space.s2) {
                LiveDot(color: .secondary)
                Text(turn.steps.last?.text ?? "Starting")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .error:
            HStack(spacing: Space.s2) {
                Label("Couldn't answer: \(turn.error ?? "no reason given")", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Color.siege)
                if let askAgain { Button("Ask Again", action: askAgain).font(.caption.weight(.semibold)).buttonStyle(.borderless) }
            }
        case .stopped:
            Label(turn.steps.last { $0.state == .warn && $0.tool == nil }?.text ?? "Stopped", systemImage: "stop.circle").font(.caption).foregroundStyle(.secondary)
        case .steered:
            Label("Your message reached him here", systemImage: "arrow.turn.down.right").font(.caption).foregroundStyle(.secondary)
        case .done:
            EmptyView()
        }
    }
}

/// The message box: on the keyboard, growing to six lines; Send, or Stop while he answers.
struct Composer: View {
    @Bindable var chat: ChatModel
    let client: NodeClient
    var composing: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            OutboxLines(outbox: chat.outbox)
            field
        }
        .padding(.horizontal, Metrics.margin)
        .padding(.vertical, Space.s2)
        .readingWidth()
        .takingFiles(chat.outbox, client: client, composing: composing)
    }

    private var field: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: Space.s2) {
                AttachButton(outbox: chat.outbox, client: client)
                // Made anew with each message sent: clearing a focused multi-line field can leave what was sent on
                // screen, or let the keyboard put back what it still held (a word it was correcting, a dictation
                // finishing). A new one is empty, and nothing late reaches it.
                TextField("Message Galahad", text: $chat.draft, axis: .vertical)
                    .plainField()
                    .id(chat.sent)
                    .lineLimit(1...6)
                    .focused(composing)
                    .padding(.horizontal, Space.s4)
                    // One line high, the field is 44 points: Apple's least for a thing to tap.
                    .padding(.vertical, 11)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22, style: .continuous))
                    .accessibilityIdentifier("composer")
                if chat.answering {
                    Button {
                        chat.stop(with: client)
                    } label: {
                        Image(systemName: "stop.fill").font(.body.weight(.semibold)).frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Stop Galahad answering")
                } else {
                    let empty = !chat.sendable
                    Button {
                        let typing = composing.wrappedValue
                        chat.send(with: client)
                        // The new box takes the keyboard where the old one had it, so it stays up for the next message.
                        if typing { Task { @MainActor in composing.wrappedValue = true } }
                    } label: {
                        Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(Prominent.label(dimmed: empty)).frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .disabled(empty)
                    .accessibilityLabel("Send")
                    .accessibilityIdentifier("send")
                }
            }
        }
    }
}
