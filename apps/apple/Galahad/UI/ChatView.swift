import SwiftUI

/// Galahad's chat: your messages and his answers as bubbles, his streaming in as it comes, and the message box on the
/// keyboard. A new chat keeps the one before it on the node.
struct ChatView: View {
    let session: Session
    @FocusState private var composing: Bool

    private var chat: ChatModel { session.chat }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if chat.messages.isEmpty { welcome }
                ForEach(chat.messages) { message in
                    MessageRow(message: message)
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
                    Text(session.galahad.text)
                        .font(.caption)
                        .foregroundStyle(session.galahad.tone == .warn ? Color.siege : .secondary)
                        .lineLimit(1)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    chat.startNew()
                    composing = true
                } label: {
                    Label("New chat", systemImage: "square.and.pencil")
                }
                .disabled(chat.answering || chat.messages.isEmpty)
            }
        }
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

/// One message: yours on the right in the ink, his on the left beside his drawing, with what he's doing above it.
struct MessageRow: View {
    let message: ChatModel.Message

    var body: some View {
        switch message.role {
        case .you:
            HStack {
                Spacer(minLength: 56)
                Text(message.text)
                    .foregroundStyle(Color.onAccent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.ink, in: .rect(cornerRadius: 20, style: .continuous))
                    .textSelection(.enabled)
            }
        case .galahad:
            HStack(alignment: .top, spacing: 10) {
                Portrait(drawing: "galahad", size: 34)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(message.steps.filter(\.tool)) { step in
                        Label(step.text, systemImage: step.state == .active ? "gearshape" : step.state == .done ? "checkmark.circle" : "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(step.state == .warn ? Color.siege : .secondary)
                    }
                    if !message.text.isEmpty {
                        Text(Self.markdown(message.text))
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
        switch message.status {
        case .streaming:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text(message.steps.last?.text ?? "Starting")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .failed(let why):
            Label("Couldn't answer: \(why)", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Color.siege)
        case .stopped:
            Label("Stopped", systemImage: "stop.circle").font(.caption).foregroundStyle(.secondary)
        case .done:
            EmptyView()
        }
    }

    /// His words with their inline markdown (bold, code, links); anything it can't read stays as it was written.
    static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
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
