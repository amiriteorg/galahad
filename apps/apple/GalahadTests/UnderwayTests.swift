import Foundation
import Testing
@testable import Galahad

/// What is under way in a chat, in words: the PWA's lib/underway.ts, word for word (apps/web/src/lib/underway.test.ts).
struct UnderwayTests {
    let copenhagen = TimeZone(identifier: "Europe/Copenhagen")!
    /// 24 November 2026, 20:07:31 UTC: 21:07 in Copenhagen.
    let now = Date(timeIntervalSince1970: 1_795_550_851)

    @Test func aTimeIsTheTimeOfDayTodayWithItsDayOnAnother() {
        #expect(UnderwayWords.when(now.addingTimeInterval(2 * 3600), now: now, zone: copenhagen) == "23:07")
        #expect(UnderwayWords.when(Date(timeIntervalSince1970: 1_795_593_600), now: now, zone: copenhagen) == "Wed 25 Nov, 09:00")
    }

    @Test func aTaskSaysHowItStands() {
        let task = UnderwayView.Task(id: "task-1", title: "The importer's tests", assignee: "gareth", name: "Gareth", status: "running", progress: "", room: "r")
        #expect(UnderwayWords.state(of: task) == "at work")
        #expect(UnderwayWords.state(of: UnderwayView.Task(id: "t", title: "x", assignee: "g", name: "G", status: "running", progress: "12 commands · running bun test\nmore", room: "r")) == "12 commands · running bun test")
        #expect(UnderwayWords.state(of: UnderwayView.Task(id: "t", title: "x", assignee: "a", name: "Ada", status: "queued", progress: "", room: "r")) == "waiting its turn")
    }

    @Test func aLookSaysWhenAndWhatAtAndComeBackIsHisOwnNote() {
        let look = UnderwayView.Look(id: "lk_AAAAAAAAAAAAAAAA", at: (now.timeIntervalSince1970 + 2 * 3600) * 1000, note: "Is the site live?")
        #expect(UnderwayWords.look(look, now: now, zone: copenhagen) == "Looking again at 23:07: Is the site live?")
        let back = StoredMessage.Look(set: now.timeIntervalSince1970 * 1000, note: "Is the site live?")
        #expect(UnderwayWords.looked(back, now: now.addingTimeInterval(3600), zone: copenhagen) == "He looked again, as he said at 21:07 he would: Is the site live?")
    }

    @Test func theNodesAnswerIsReadAsItComes() throws {
        let json = #"{"tasks":[{"id":"task-1","title":"T","assignee":"gareth","name":"Gareth","status":"running","progress":"","room":"room-1","createdAt":1,"updatedAt":2}],"looks":[{"id":"lk_AAAAAAAAAAAAAAAA","conversation":"cv_x","at":1795558051000,"note":"N","set":1795550851000,"zone":"Europe/Copenhagen","state":"waiting","why":null}]}"#
        let view = try JSONDecoder().decode(UnderwayView.self, from: Data(json.utf8))
        #expect(view.tasks.map(\.name) == ["Gareth"])
        #expect(view.looks.map(\.note) == ["N"])
        #expect(!view.isEmpty)
    }
}
