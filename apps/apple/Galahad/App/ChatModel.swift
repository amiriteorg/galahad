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
 * Your conversation with Galahad, as this app shows it. A message starts a turn the node owns, and his answer streams
 * into its bubble as it comes (apps/web/src/lib/turns.ts reads the same events): what he's at shows as its steps, named
 * as the PWA names them. Leaving the screen ends the watching, never the turn; Stop asks the node to stop it.
 */
@MainActor @Observable final class ChatModel {
    struct Step: Identifiable, Equatable {
        enum State: Equatable { case active, done, warn }
        let id: String
        var text: String
        /// One of his tools, rather than a stage of the answer.
        var tool: Bool
        var state: State
    }

    struct Message: Identifiable, Equatable {
        enum Role: Equatable { case you, galahad }
        enum Status: Equatable { case streaming, done, stopped, failed(String) }
        let id = UUID()
        let role: Role
        var text: String
        var steps: [Step] = []
        var status = Status.done
    }

    /// The role his answers come from (the PWA's default).
    let role = "planner"
    private(set) var messages: [Message] = []
    /// The kept chat this is (nil until the node has said).
    private(set) var conversation: String?
    /// The turn under way, by its id on the node.
    private(set) var turn: String?
    var draft = ""
    private var live: Task<Void, Never>?
    private var failure: String?

    var answering: Bool { live != nil }
    /// What his answer is at: its last step (nil when he has only just started).
    var step: String? { messages.last { $0.role == .galahad }?.steps.last?.text }

    func send(with client: NodeClient) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard live == nil, !text.isEmpty else { return }
        draft = ""
        messages.append(Message(role: .you, text: text))
        messages.append(Message(role: .galahad, text: "", status: .streaming))
        failure = nil
        let request = ChatRequest(role: role, save: conversation == nil ? true : nil, conversation: conversation, messages: [.init(role: "user", content: text)])
        live = Task {
            do {
                for try await event in client.events("/api/chat", request) { apply(event) }
                end(nil)
            } catch is CancellationError {
                end(nil)
            } catch {
                end(error.localizedDescription)
            }
        }
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
        messages = []
        conversation = nil
    }

    private func apply(_ event: ChatEvent) {
        guard let index = messages.lastIndex(where: { $0.role == .galahad }) else { return }
        switch event {
        case .turn(let id, let kept):
            turn = id
            if let kept { conversation = kept }
            add(index, Step(id: "asked", text: "Asked as \(role)", tool: false, state: .done))
        case .conversation(let id, _):
            conversation = id
        case .model(let ref):
            add(index, Step(id: "model-\(ref)", text: "Thinking with \(ref)", tool: false, state: .active))
        case .text(let text):
            if !(messages[index].steps.last.map { $0.text == "Answering" && $0.state == .active } ?? false) {
                add(index, Step(id: "answering-\(messages[index].steps.count)", text: "Answering", tool: false, state: .active))
            }
            messages[index].text += text
        case .tool(let id, let title):
            add(index, Step(id: "tool-\(id)", text: title, tool: true, state: .active))
        case .toolResult(let id, let ok, _):
            if let at = messages[index].steps.firstIndex(where: { $0.id == "tool-\(id)" }) { messages[index].steps[at].state = ok ? .done : .warn }
        case .stopped:
            messages[index].status = .stopped
        case .error(let message):
            failure = message
        case .done, .other:
            break
        }
    }

    /// A new step; the one before it, if still under way, is over.
    private func add(_ index: Int, _ step: Step) {
        if let last = messages[index].steps.indices.last, messages[index].steps[last].state == .active, !messages[index].steps[last].tool {
            messages[index].steps[last].state = .done
        }
        messages[index].steps.append(step)
    }

    /// The stream ended: the answer it was writing is settled (done, or failed with why).
    private func end(_ error: String?) {
        live = nil
        turn = nil
        guard let index = messages.lastIndex(where: { $0.role == .galahad }), messages[index].status == .streaming else { return }
        if let why = failure ?? error {
            messages[index].status = .failed(why)
        } else {
            messages[index].status = .done
            if let last = messages[index].steps.indices.last, messages[index].steps[last].state == .active { messages[index].steps[last].state = .done }
        }
    }
}
