import Foundation
import Testing
@testable import Galahad

/// An approval is said as the PWA's Inbox says it (apps/web/src/views/inbox.ts, lib/orders.ts).
struct ApprovalTests {
    @Test func whoAskedIsSaidInWords() {
        #expect(Approval.askedBy("loop:morning") == "the loop morning")
        #expect(Approval.askedBy("arm:release-bot") == "the arm release-bot")
        #expect(Approval.askedBy("node:keep") == "the node keep")
        #expect(Approval.askedBy("quest:q-1") == "the quest q-1")
        #expect(Approval.askedBy("you") == "you")
        #expect(Approval.askedBy("arm:") == "arm:")
    }

    @Test func aDeleteIsConfirmedByTypingWhatItDeletes() {
        let call = { (target: String, args: [String: JSONValue]) in Approval.deleteName(connector: "forge", tool: "bucket.delete", target: target, args: args) }
        #expect(call("DELETE https://forge.example/buckets/scratch", [:]) == "scratch")
        #expect(call("DELETE /v1/buckets/scratch%20two?force=1#x", [:]) == "scratch two")
        #expect(call("DELETE /", [:]) == "forge.bucket.delete")
        #expect(call("mcp deleteIssue {\"id\":42}", ["id": .number(42)]) == "42")
        #expect(call("mcp deleteIssue {}", ["id": .number(42), "repo": .string("galahad")]) == "forge.bucket.delete")
        #expect(call("DELETE /buckets/%E0%A4%A", [:]) == "%E0%A4%A")
    }
}
