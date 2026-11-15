import Foundation
import Testing
@testable import Galahad

/// The chats list is the PWA's (`apps/web/src/lib/chats.ts`, core's `chatStateWords`): its headings, its order, and
/// each chat's state in the PWA's own words.
struct ChatsTests {
    let chats = Vectors.shared.chats

    @Test func pinnedFirstThenByWhenEachWasLastActive() {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let groups = Chats.groups(chats.list, now: Date(timeIntervalSince1970: chats.now / 1000), calendar: utc)
        #expect(groups.map(\.label) == chats.groups.map(\.label))
        #expect(groups.map { $0.items.map(\.id) } == chats.groups.map(\.ids))
    }

    @Test func eachChatsStateIsSaidInThePWAsWords() {
        for state in chats.states {
            #expect(Chats.stateWords(state: state.state, queued: state.queued, held: state.held, needs: state.needs) == state.words)
        }
    }

    @Test func searchFindsEveryWordInTheTitleAndGalahadsRowOpensTheLatest() {
        #expect(Chats.filter(chats.list, query: "  JUST  now ").map(\.id) == ["just-now"])
        #expect(Chats.filter(chats.list, query: "").count == chats.list.count)
        // A pin doesn't make a chat more recent.
        #expect(Chats.mostRecent(chats.list)?.id == "just-now")
        #expect(Chats.mostRecent([]) == nil)
    }
}
