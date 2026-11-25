import Foundation
import Testing
@testable import Galahad

/// A knight's orb's colours, as core gives them (`avatar.ts`' knightColors: the colour you chose for it, or one of 24 its
/// handle picks; your word, 25 November 2026: "drop the knight avatars, and just use custom/procedurally generated colored
/// particle orbs"), and what a knight is doing as its orb shows it (`taskStep`, `avatarExpression`): checked against
/// their own output.
struct KnightOrbTests {
    let orbs = Vectors.shared.knightOrbs
    let roundtable = Vectors.shared.roundtable

    @Test func theTwentyFourTintsAndTheirNamesAreCores() {
        #expect(KnightOrb.tints == orbs.tints)
        #expect(KnightOrb.tintNames == orbs.names)
        #expect(Set(KnightOrb.tints).count == 24)
        for tint in KnightOrb.tints { #expect(KnightOrb.isHex(tint) && tint == tint.lowercased(), "\(tint)") }
    }

    @Test func eachKnightsColoursAreCoresFromItsHandleOrTheColourYouChose() {
        #expect(!orbs.knights.isEmpty)
        for item in orbs.knights {
            let theirs = item.colors
            #expect(KnightOrb.colors(id: item.id, profile: item.avatar) == KnightOrb.Colors(tint: theirs.tint, light: theirs.light, deep: theirs.deep, second: theirs.second, chosen: theirs.chosen), "\(item.id)")
        }
        // Both are among them: colours chosen, and handles' colours (a look from the drawings among those, colouring nothing).
        #expect(orbs.knights.contains { $0.colors.chosen })
        #expect(orbs.knights.contains { !$0.colors.chosen && $0.avatar != nil })
    }

    @Test func aHandlesSeedIsFNV1aOverItsUTF16AsCoresIs() {
        #expect(!orbs.seeds.isEmpty)
        for item in orbs.seeds { #expect(Orb.seed(item.id) == item.seed, "\(item.id)") }
    }

    @Test func coloursBlendInWholeChannelsAndFindTheirNearestTintAsCoresDo() {
        #expect(!orbs.blends.isEmpty && !orbs.nearest.isEmpty)
        for item in orbs.blends { #expect(KnightOrb.blend(item.from, item.to, item.t) == item.blend, "\(item.from) → \(item.to) at \(item.t)") }
        for item in orbs.nearest { #expect(KnightOrb.nearestTint(item.color) == item.at, "\(item.color)") }
    }

    @Test func onlyAColourYouChoseColoursAnOrb() {
        #expect(KnightOrb.chosenColor(.object(["v": .number(2), "color": .string("#3ABEFF")])) == "#3abeff")
        let odd: [JSONValue?] = [
            nil, .null, .string("#3abeff"), .array([]),
            .object(["v": .number(2), "color": .string("blue")]),
            .object(["v": .number(2), "color": .string("#3abeff"), "form": .string("round")]),
            .object(["v": .string("2"), "color": .string("#3abeff")]),
            .object(["v": .number(3), "color": .string("#3abeff")]),
            .object(["v": .number(2)]),
            .object(["v": .number(1), "form": .string("round"), "color": .string("#be7153"), "accent": .string("#6b4536"), "eyes": .string("oval"), "accessory": .string("none"), "temperament": .string("calm")]),
        ]
        for profile in odd {
            #expect(KnightOrb.chosenColor(profile) == nil, "\(String(describing: profile))")
            #expect(KnightOrb.colors(id: "gareth", profile: profile) == KnightOrb.colors(id: "gareth", profile: nil), "\(String(describing: profile))")
        }
    }

    @Test func handlesSpreadRoundAllTwentyFourAndASecondColourIsThreeToSixOn() {
        // The same every time, and many handles reach every tint.
        #expect(KnightOrb.colors(id: "gareth", profile: nil) == KnightOrb.colors(id: "gareth", profile: nil))
        #expect(Set((0..<400).map { KnightOrb.colors(id: "knight-\($0)", profile: nil).tint }) == Set(KnightOrb.tints))
        for n in 0..<200 {
            let colors = KnightOrb.colors(id: "knight-\(n)", profile: nil)
            let steps = (KnightOrb.tints.firstIndex(of: colors.second)! - KnightOrb.tints.firstIndex(of: colors.tint)! + 24) % 24
            #expect((3...6).contains(steps), "knight-\(n)")
            #expect(!colors.chosen)
        }
    }

    @Test func aRunningTasksLineShowsAsCoreSays() {
        #expect(!Vectors.shared.faces.steps.isEmpty)
        for item in Vectors.shared.faces.steps { #expect(KnightOrb.step(item.line) == item.step, "\(item.line)") }
    }

    @Test func whatEachKnightAtTheRoundtableIsDoingIsThePWAs() {
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: roundtable.asks, now: roundtable.now)
        #expect(rows.map(\.id) == roundtable.rows.map(\.id))
        for (row, expected) in zip(rows, roundtable.rows) { #expect(row.expression == expected.expression, "\(row.id)") }
    }
}
