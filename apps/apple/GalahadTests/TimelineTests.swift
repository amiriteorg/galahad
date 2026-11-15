import Foundation
import Testing
@testable import Galahad

/// A knight's page is the PWA's (`lib/timeline.ts`, `lib/task-card.ts`, `lib/team.ts`): the same words and work in the
/// same order, the same names for who said what, and each task's card saying what the PWA's says.
struct TimelineTests {
    let t = Vectors.shared.timelines

    @Test func wordsAndWorkStandInTheOrderTheyHappened() {
        let own = Timeline.tasks(room: ("dm-ada", true, ["ada"]), all: t.tasks)
        #expect(Timeline.items(messages: t.messages, tasks: own).map(\.id) == t.knight)
        // A room shared by several knights holds the room's own work, not each knight's everywhere.
        let shared = Timeline.tasks(room: ("dm-ada", false, ["ada", "bea"]), all: t.tasks)
        #expect(Timeline.items(messages: t.messages, tasks: shared).map(\.id) == t.room)
        // Words from a moment on: work that ended before it goes with the words before it; work in hand stays.
        #expect(Timeline.items(messages: t.messages, tasks: own, since: t.sinceAt).map(\.id) == t.since)
    }

    @Test func whoSaidItIsNamedAsThePWANamesThem() {
        let teammates = Vectors.shared.roundtable.snapshot.teammates
        #expect(t.messages.map { Timeline.speaker($0, teammates: teammates) } == t.speakers)
    }

    @Test func eachTasksCardSaysWhatThePWAsSays() {
        for (task, card) in zip(t.tasks, t.cards) {
            let badge = TaskCard.badge(task)
            #expect([badge.text, badge.tone.rawValue] == [card.badge.text, card.badge.tone], "\(task.id)")
            let end = TaskCard.end(task)
            #expect(end?.why == card.end?.why && end?.said == card.end?.said, "\(task.id)")
            #expect((end == nil) == (card.end == nil), "\(task.id)")
            #expect(TaskCard.actions(task).map(\.rawValue) == card.actions, "\(task.id)")
            #expect(TaskCard.given(task) == card.given, "\(task.id)")
            #expect(TaskCard.kept(task) == card.kept, "\(task.id)")
        }
        #expect(t.tasks.count == t.cards.count)
    }

    @Test func aTasksCommandsAreOneALineAndBounded() throws {
        #expect(try KnightRoom.gates(from: "  bun run check \n\n bun test a.ts\n").get() == ["bun run check", "bun test a.ts"])
        #expect(throws: NodeError.self) { try KnightRoom.gates(from: (1...17).map { "c\($0)" }.joined(separator: "\n")).get() }
        #expect(throws: NodeError.self) { try KnightRoom.gates(from: String(repeating: "x", count: 1001)).get() }
    }
}
