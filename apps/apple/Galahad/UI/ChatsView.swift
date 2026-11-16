import SwiftUI

/// Every chat you've had with Galahad, kept on your node: pinned first, then by when each was last active, each with
/// where it stands. Open one to carry it on; swipe to pin it or delete it for good.
struct ChatsView: View {
    let session: Session
    let open: (String) -> Void
    let startNew: () -> Void
    @Environment(\.dismiss) private var dismiss
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @State private var chats: [ConversationSummary]?
    @State private var problem: String?
    @State private var query = ""
    @State private var deleting: ConversationSummary?

    private var groups: [Chats.Group] { Chats.groups(Chats.filter(chats ?? [], query: query)) }

    var body: some View {
        NavigationStack {
            List {
                if let problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege)
                }
                ForEach(groups, id: \.label) { group in
                    Section(group.label) {
                        ForEach(group.items) { chat in
                            Button {
                                open(chat.id)
                            } label: {
                                ChatRow(chat: chat, group: group.label, current: chat.id == session.chat.conversation)
                            }
                            .tint(.primary)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { deleting = chat } label: { Label("Delete", systemImage: "trash") }
                            }
                            .swipeActions(edge: .leading) {
                                Button { Task { await pin(chat, !chat.pinned) } } label: {
                                    Label(chat.pinned ? "Unpin" : "Pin", systemImage: chat.pinned ? "pin.slash" : "pin")
                                }
                                .tint(.ink)
                            }
                            #if os(macOS)
                            // A Mac opens a chat in a window of its own, and has the swipes' actions in the row's menu.
                            .contextMenu {
                                Button("Open in New Window") {
                                    openWindow(value: MacWindow.chat(chat.id))
                                    dismiss()
                                }
                                Button(chat.pinned ? "Unpin" : "Pin") { Task { await pin(chat, !chat.pinned) } }
                                Divider()
                                Button("Delete…", role: .destructive) { deleting = chat }
                            }
                            #endif
                        }
                    }
                }
            }
            .navigationTitle("Chats")
            .inlineTitle()
            .searchable(text: $query, placement: .alwaysShown, prompt: "Chats")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(action: startNew) { Label("New chat", systemImage: "square.and.pencil") }
                        .disabled(session.chat.answering)
                }
            }
            .overlay {
                if chats == nil, problem == nil {
                    ProgressView()
                } else if chats?.isEmpty == true {
                    ContentUnavailableView("No chats yet", systemImage: "bubble.left.and.bubble.right", description: Text("What you ask Galahad is kept here, on your node."))
                } else if groups.isEmpty, !query.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .confirmationDialog("Delete this chat?", isPresented: .init(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { chat in
                Button("Delete", role: .destructive) { Task { await delete(chat) } }
            } message: { chat in
                Text("“\(chat.title)” is gone for good, on \(session.whoami?.nodeName ?? session.node.nodeName ?? "your node"). If he's working in it, he stops.")
            }
        }
        .sheetSize(width: 520, height: 640)
    }

    private struct Listed: Decodable { let conversations: [ConversationSummary] }

    private func load() async {
        do {
            chats = try await session.client.get("/api/conversations", as: Listed.self).conversations
            problem = nil
        } catch {
            problem = "Your chats couldn't be read: \(error.localizedDescription)"
            if chats == nil { chats = [] }
        }
    }

    private func pin(_ chat: ConversationSummary, _ pinned: Bool) async {
        struct Update: Encodable { let id: String; let pinned: Bool }
        do {
            _ = try await session.client.post("/api/conversations/update", Update(id: chat.id, pinned: pinned), as: JSONValue.self)
            await load()
        } catch {
            problem = error.localizedDescription
        }
    }

    private func delete(_ chat: ConversationSummary) async {
        struct Delete: Encodable { let id: String }
        do {
            _ = try await session.client.post("/api/conversations/delete", Delete(id: chat.id), as: JSONValue.self)
            session.chat.forget(chat.id)
            await load()
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// A chat in the list: its title, where it stands (in Galahad's red when it needs you), and when it was last active.
struct ChatRow: View {
    let chat: ConversationSummary
    /// The heading it's under, which says how its time reads.
    let group: String
    /// It's the chat on screen.
    let current: Bool

    private var words: String { Chats.stateWords(chat) }
    private var needsYou: Bool { chat.state == "waiting" || chat.state == "failed" }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
            VStack(alignment: .leading, spacing: Space.line) {
                HStack(spacing: Space.s2) {
                    if chat.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
                    Text(chat.title).font(.body.weight(current ? .semibold : .regular)).lineLimit(1)
                }
                if !words.isEmpty {
                    HStack(spacing: Space.s2) {
                        // The words say it; the spinner is for the eye, so the row stays a button to VoiceOver.
                        if chat.state == "working" { ProgressView().controlSize(.mini).accessibilityHidden(true) }
                        Text(words).lineLimit(2)
                    }
                    .font(.subheadline)
                    .foregroundStyle(needsYou ? Color.siege : .secondary)
                }
            }
            Spacer(minLength: Space.s2)
            Text(when).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
        }
        .padding(.vertical, Space.s1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    /// Today a time, this week a weekday, before that a date (the heading says the rest).
    private var when: String {
        let date = Date(timeIntervalSince1970: chat.updatedAt / 1000)
        switch group {
        case "Today": return date.formatted(date: .omitted, time: .shortened)
        case "Yesterday": return date.formatted(date: .omitted, time: .shortened)
        case "This week": return date.formatted(.dateTime.weekday(.wide))
        default: return date.formatted(.dateTime.day().month(.abbreviated))
        }
    }
}
