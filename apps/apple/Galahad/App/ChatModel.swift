import Foundation
import Observation

/// What `POST /api/chat` takes, as far as this app asks: a role, and either a new kept chat or the one it continues.
struct ChatRequest: Encodable, Sendable {
    struct Message: Encodable, Sendable { let role: String; let content: String }
    let role: String
    /// A new conversation, kept in your history from its first message.
    var save: Bool?
    /// The kept conversation this message continues: the node holds what was said, so only the message goes.
    var conversation: String?
    let messages: [Message]
}

/**
 * Your conversation with Galahad, as this app shows it. A chat is kept on the node: opening one shows what it holds,
 * and when he is still answering in it, the app attaches to his turn, which the node replays from its start and then
 * streams live. A message starts (or continues) a turn the node owns; his answer streams into its bubble as it comes,
 * with what he's at as its steps (`ChatThread`, the PWA's lib/turns.ts). Leaving a chat ends the watching, never the
 * turn; Stop asks the node to stop it.
 */
@MainActor @Observable final class ChatModel {
    /// The role his answers come from (the PWA's default), until a kept chat says its own.
    private(set) var role = "planner"
    private(set) var thread = ChatThread()
    /// The kept chat on screen (nil: a new one, until the node keeps it).
    private(set) var conversation: String?
    private(set) var title: String?
    /// The turn under way, by its id on the node.
    private(set) var turn: String?
    /// A chat is being read from the node.
    private(set) var loading = false
    /// Why the chat couldn't be read.
    private(set) var problem: String?
    var draft = ""
    /// How many messages this chat screen has sent: the message box is made anew with each one (see `Composer`).
    private(set) var sent = 0
    private var live: Task<Void, Never>?
    /// The watch whose events the chat on screen takes.
    private var watching: UUID?
    /// Galahad's latest chat has been looked for since the app opened (his row opens it).
    private var opened = false

    var answering: Bool { live != nil }
    /// What his answer is at: its last step (nil when he has only just started).
    var step: String? { thread.turns.last { $0.role == .assistant }?.steps.last?.text }

    /// His row opens his latest chat, once; after that the chat on screen stays until you choose another.
    func openLatest(with client: NodeClient) async {
        guard !opened, conversation == nil, thread.isEmpty, live == nil else { return }
        opened = true
        struct Listed: Decodable { let conversations: [ConversationSummary] }
        guard let latest = try? await Chats.mostRecent(client.get("/api/conversations", as: Listed.self).conversations) else { return }
        await open(latest.id, with: client)
    }

    /// A kept chat, as the node holds it; if he is answering in it, his turn is watched from where it stands.
    func open(_ id: String, with client: NodeClient) async {
        leave()
        opened = true
        loading = true
        defer { loading = false }
        struct Get: Encodable { let id: String }
        struct Got: Decodable { let conversation: ConversationDetail }
        do {
            let detail = try await client.post("/api/conversations/get", Get(id: id), as: Got.self).conversation
            (conversation, title, role, problem, turn) = (detail.id, detail.title, detail.role, nil, nil)
            thread = ChatThread(kept: detail.messages, role: detail.role)
            if let running = detail.turn { attach(running.id, with: client) }
        } catch {
            problem = error.localizedDescription
        }
    }

    func send(with client: NodeClient) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard live == nil, !text.isEmpty else { return }
        draft = ""
        sent += 1
        thread.begin(question: text, role: role)
        let request = ChatRequest(role: role, save: conversation == nil ? true : nil, conversation: conversation, messages: [.init(role: "user", content: text)])
        watch(client.events("/api/chat", request))
    }

    /// A choice he offered, tapped: sent as your reply, through the message box's own checks.
    func reply(_ text: String, with client: NodeClient) {
        guard live == nil else { return }
        draft = text
        send(with: client)
    }

    /// Asks the node to stop the turn under way; the stream then says it stopped, and ends.
    func stop(with client: NodeClient) {
        guard let turn else { live?.cancel(); return }
        Task {
            struct Stop: Encodable { let turn: String }
            _ = try? await client.post("/api/turns/stop", Stop(turn: turn), as: JSONValue.self)
        }
    }

    /// A new chat. The one before stays kept on the node.
    func startNew() {
        guard live == nil else { return }
        thread = ChatThread()
        (conversation, title, problem, role) = (nil, nil, nil, "planner")
        opened = true
    }

    /// The chat on screen was deleted: what's left is a new one.
    func forget(_ id: String) {
        guard conversation == id else { return }
        leave()
        startNew()
    }

    /// A turn already under way: the node replays it from its start, then streams the rest.
    private func attach(_ id: String, with client: NodeClient) {
        struct Attach: Encodable { let turn: String }
        turn = id
        watch(client.events("/api/turns/attach", Attach(turn: id)))
    }

    private func watch(_ events: AsyncThrowingStream<ChatEvent, any Error>) {
        // Each watch is its own: one that was left (another chat opened) says nothing more to the chat on screen.
        let watch = UUID()
        watching = watch
        live = Task {
            do {
                for try await event in events {
                    guard watching == watch else { return }
                    switch event {
                    case .turn(let id, let kept, _, _, _):
                        turn = id
                        if let kept { conversation = kept }
                    case .conversation(let id, let named):
                        (conversation, title) = (id, named)
                    default: break
                    }
                    thread.apply(event)
                }
                guard watching == watch, !Task.isCancelled else { return }
                thread.end()
            } catch {
                // Leaving the chat ends the watching, never the turn: what it has said so far stays as it stands.
                guard watching == watch, !Task.isCancelled, !(error is CancellationError) else { return }
                // The watching was cut (the app was away, the network dropped), not the turn: coming back finds it again.
                thread.fail(error.localizedDescription)
            }
            guard watching == watch else { return }
            (live, turn, watching) = (nil, nil, nil)
        }
    }

    /// Back in the app, or after the watching was cut: the chat on screen as the node holds it now.
    func resume(with client: NodeClient) async {
        guard let conversation, live == nil, !loading else { return }
        await open(conversation, with: client)
    }

    /// Which writing of the chats the node said last (`chats` on `GET /api/turns`; nil: none yet).
    private var seenChats: String?

    /// What the node said on its latest look (every few seconds while the app is open): when anything kept has changed
    /// (a chat begun, answered or renamed on another device), or he is answering in the chat on screen for another
    /// device, the chat on screen as the node holds it. Never while this device is sending or watching.
    func noticed(chats: String?, turns: [TurnView], with client: NodeClient) async {
        let changed = chats != nil && seenChats != nil && chats != seenChats
        if let chats { seenChats = chats }
        guard let conversation, live == nil, !loading else { return }
        guard changed || turns.contains(where: { $0.conversation == conversation }) else { return }
        struct Get: Encodable { let id: String }
        struct Got: Decodable { let conversation: ConversationDetail }
        guard let detail = try? await client.post("/api/conversations/get", Get(id: conversation), as: Got.self).conversation,
              self.conversation == conversation, live == nil, !loading else { return }
        title = detail.title
        // Shown again only where the node holds what isn't on screen; his turn in it, attached to.
        if Chats.keptDiffers(shown: thread.turns, kept: detail.messages) { thread = ChatThread(kept: detail.messages, role: detail.role) }
        if let running = detail.turn { attach(running.id, with: client) }
    }

    private func leave() {
        live?.cancel()
        (live, watching) = (nil, nil)
    }
}
