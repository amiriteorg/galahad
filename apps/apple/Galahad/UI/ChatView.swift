import SwiftUI

/// Galahad's chat: your messages and his answers as bubbles, his streaming in as it comes, and the message box on the
/// keyboard. A new chat keeps the one before it on the node.
struct ChatView: View {
    let session: Session
    @FocusState private var composing: Bool
    @State private var listing = false

    private var chat: ChatModel { session.chat }
    private var latestAnswer: Int? { chat.thread.turns.last { $0.role == .assistant }?.id }

    var body: some View {
        ScrollView {
            // A plain stack: an answer's rows are tall and hold sideways-scrolling code and tables, and a lazy stack
            // pinned to the bottom kept placing them again and never settled (seen in the iOS 26.1 simulator).
            VStack(alignment: .leading, spacing: 16) {
                if chat.thread.isEmpty {
                    if chat.loading { ProgressView().frame(maxWidth: .infinity).padding(.top, 80) } else { welcome }
                }
                if let problem = chat.problem {
                    Label("This chat couldn't be read: \(problem)", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.siege)
                }
                ForEach(chat.thread.turns) { turn in
                    MessageRow(turn: turn)
                        .environment(\.answerLive, turn.status == .streaming)
                        // Choices he offered are yours to tap on his latest finished answer only.
                        .environment(\.choose, turn.id == latestAnswer && turn.status == .done && !chat.answering ? { text in chat.reply(text, with: session.client) } : nil)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            Composer(chat: chat, client: session.client, composing: $composing)
        }
        .navigationTitle("Galahad")
        .navigationBarTitleDisplayMode(.inline)
        // A conversation has the screen to itself, as in Messages.
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text("Galahad").font(.headline)
                    Text(chat.title ?? session.galahad.text)
                        .font(.caption)
                        .foregroundStyle(chat.title == nil && session.galahad.tone == .warn ? Color.siege : .secondary)
                        .lineLimit(1)
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
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
    }

    private var welcome: some View {
        VStack(spacing: 12) {
            Portrait(drawing: "galahad", size: 150)
            Text("Ask Galahad").font(.title2.bold())
            Text("He answers with his tools at hand, within what this device may do. What you say here is kept on your node.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        .padding(.horizontal, 24)
    }
}

/// One message: yours on the right in the ink, his on the left beside his drawing, with what he did above it.
struct MessageRow: View {
    let turn: ChatThread.Turn

    var body: some View {
        switch turn.role {
        case .user:
            HStack {
                Spacer(minLength: 56)
                Text(turn.content)
                    .foregroundStyle(Color.onAccent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.ink, in: .rect(cornerRadius: 20, style: .continuous))
                    .textSelection(.enabled)
            }
        case .assistant:
            HStack(alignment: .top, spacing: 10) {
                Portrait(drawing: "galahad", size: 34)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(turn.steps.enumerated()).filter { $0.element.tool != nil }, id: \.offset) { _, step in
                        Label(step.text, systemImage: step.state == .active ? "gearshape" : step.state == .done ? "checkmark.circle" : "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(step.state == .warn || step.state == .error ? Color.siege : .secondary)
                    }
                    if !turn.content.isEmpty {
                        MarkdownView(turn.content)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(.fill.tertiary, in: .rect(cornerRadius: 20, style: .continuous))
                            .textSelection(.enabled)
                            .accessibilityIdentifier("galahad-answer")
                    }
                    footer
                }
                Spacer(minLength: 24)
            }
        }
    }

    @ViewBuilder private var footer: some View {
        switch turn.status {
        case .streaming:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text(turn.steps.last?.text ?? "Starting")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .error:
            Label("Couldn't answer: \(turn.error ?? "no reason given")", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Color.siege)
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
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message Galahad", text: $chat.draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused(composing)
                    .padding(.horizontal, 16)
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
                    let empty = chat.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    Button {
                        chat.send(with: client)
                    } label: {
                        Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(empty ? Color.secondary : Color.onAccent).frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .disabled(empty)
                    .accessibilityLabel("Send")
                    .accessibilityIdentifier("send")
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
}
