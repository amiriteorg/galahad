import Foundation
import Testing
@testable import Galahad

/// A chat on screen is the PWA's, turn for turn (`apps/web/src/lib/turns.ts`): a kept chat as it stands, a turn's stream
/// applied event by event, a turn attached to while it runs and rebuilt from the node's replay, and a watch cut short.
struct ThreadTests {
    let vectors = Vectors.shared

    @Test(arguments: Vectors.shared.threads.map(\.name))
    func aChatReadsAsThePWAShowsIt(_ name: String) throws {
        let scenario = try #require(vectors.threads.first { $0.name == name })
        var thread = ChatThread(kept: scenario.messages, role: scenario.role)
        if let question = scenario.question { thread.begin(question: question, role: scenario.role) }
        for event in scenario.events {
            switch event {
            case .null: thread.end()
            case .string(let cut): thread.fail(cut)
            default: thread.apply(try #require(ChatEvent(json: event.text), "\(name): \(event.text)"))
            }
        }
        let shown = thread.turns.map { turn in
            Vectors.Thread.Turn(
                role: turn.role.rawValue,
                content: turn.content,
                status: turn.status.rawValue,
                error: turn.error,
                sid: turn.sid,
                steps: turn.steps.map { .init(text: $0.text, detail: $0.detail, state: $0.state.rawValue, tool: $0.tool) }
            )
        }
        #expect(shown == scenario.turns)
    }

    @Test func aWatchThatWasLeftEndsNothing() {
        // Nothing is being written: ending or failing changes nothing on screen.
        var thread = ChatThread(kept: vectors.threads[0].messages, role: "planner")
        let before = thread
        thread.end()
        thread.fail("gone")
        #expect(thread == before)
    }
}
