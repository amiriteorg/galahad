import Foundation
import Testing
@testable import Galahad

/// The knights' live eyes, as the PWA draws them (`lib/knight-eyes.ts`, `ui/avatar.ts`) and core says what a knight is
/// doing (`avatarExpression`, `taskStep`): checked against their own output.
struct KnightEyesTests {
    let eyes = Vectors.shared.eyes
    let roundtable = Vectors.shared.roundtable

    @Test func everyDrawingsEyesAreWhereThePWADrawsThem() {
        #expect(KnightEyes.canvas == eyes.canvas)
        #expect(Set(KnightEyes.art.keys) == Set(eyes.art.keys))
        for (art, pair) in eyes.art {
            #expect(KnightEyes.art[art] == pair.map { KnightEyes.Eye(x: $0.x, y: $0.y, r: $0.r, slit: $0.slit) }, "\(art)")
        }
    }

    @Test func eachStateShowsItsEyesAsThePWADoes() {
        #expect(Set(KnightEyes.shown.keys) == Set(eyes.shown.keys))
        for (expression, shown) in eyes.shown {
            let mine = KnightEyes.shown[expression]
            #expect(mine?.eyes.rawValue == shown.eyes, "\(expression)")
            #expect(mine.map { [$0.gaze.x, $0.gaze.y] } == shown.gaze, "\(expression)")
        }
    }

    @Test func aRunningTasksLineShowsAsCoreSays() {
        for item in eyes.steps { #expect(KnightEyes.step(item.line) == item.step, "\(item.line)") }
    }

    @Test func everyKnightsFaceOnTheRoundtableIsThePWAs() {
        let rows = Roster.rows(snapshot: roundtable.snapshot, asks: roundtable.asks, now: roundtable.now)
        for (row, expected) in zip(rows, roundtable.rows) { #expect(row.expression == expected.expression, "\(row.id)") }
    }

    @Test func itBlinksBrieflyAtItsOwnMomentAndShutEyesNeverBlink() {
        // Open nearly all the time; more than half shut for under a quarter of a second, every 5.3 seconds (the PWA's
        // blink: shut by 95.5% of the cycle, open again by its end).
        let samples = stride(from: 0.0, to: 5.3, by: 0.01).map { KnightEyes.blink(at: $0, beat: 0) }
        #expect(samples.filter { $0 < 0.5 }.count < 25)
        #expect(samples.contains { $0 < 0.2 })
        #expect(KnightEyes.blink(at: 0, beat: 0) == 1)
        // Two knights' blinks fall at different moments.
        let shut = { (beat: Int) in stride(from: 0.0, to: 5.3, by: 0.01).first { KnightEyes.blink(at: $0, beat: beat) < 0.2 }! }
        #expect(abs(shut(0) - shut(1)) > 0.5)
        #expect(!KnightEyes.blinks("pleased") && !KnightEyes.blinks("resting") && KnightEyes.blinks("asking"))
    }

    @Test func itsEyesWanderOnlyAsItsStateHasThemAndStayOnItsFace() {
        // A calm knight at rest looks straight ahead; a curious one glances; work moves along the work.
        #expect(stride(from: 0.0, to: 8.5, by: 0.1).allSatisfy { KnightEyes.gaze(at: $0, expression: "idle", temper: "calm", beat: 0) == (0, 0) })
        #expect(stride(from: 0.0, to: 8.5, by: 0.1).contains { KnightEyes.gaze(at: $0, expression: "idle", temper: "curious", beat: 0).x != 0 })
        for expression in ["working", "reading", "browsing", "checking", "thinking"] {
            let moves = stride(from: 0.0, to: 4, by: 0.05).map { KnightEyes.gaze(at: $0, expression: expression, temper: "calm", beat: 2) }
            #expect(moves.contains { $0.x != 0 || $0.y != 0 }, "\(expression)")
            // Never further than the cover drawn over the drawn eye allows (5 units of 768, a third of an eye).
            #expect(moves.allSatisfy { abs($0.x) <= 5 && abs($0.y) <= 4 }, "\(expression)")
        }
    }
}

struct KnightEyeFramesTests {
    @Test func eyesAtRestAreDrawnOnlyWhileTheyBlinkOrGlance() {
        let moments = KnightEyes.moments(expression: "idle", temper: "calm", beat: 0)!
        // Asked from a moment at rest, the next frame is the start of the next blink, not a thirtieth of a second on.
        let rest = 0.5
        let next = KnightEyes.nextMove(after: rest, in: moments)!
        #expect(next > rest + 1)
        #expect(KnightEyes.blink(at: next + 0.05, beat: 0) < 1)
        // Inside a blink every frame is drawn.
        #expect(KnightEyes.nextMove(after: next + 0.05, in: moments) == next + 0.05)
        // Eyes that follow the work move all the time; shut eyes never.
        #expect(KnightEyes.moments(expression: "working", temper: "calm", beat: 0) == nil)
        #expect(KnightEyes.nextMove(after: 0, in: KnightEyes.moments(expression: "resting", temper: "calm", beat: 0)!) == nil)
        // A curious knight at rest glances too.
        #expect(KnightEyes.moments(expression: "idle", temper: "curious", beat: 0)!.count == 2)
    }
}

struct KnightEyeSizeTests {
    @Test func smallFacesOnlyBlinkAndBigOnesFollowTheWork() {
        #expect(KnightEyes.moments(expression: "working", temper: "calm", beat: 0, size: 48)?.count == 1)
        #expect(KnightEyes.moments(expression: "working", temper: "calm", beat: 0, size: 120) == nil)
        #expect(KnightEyes.moments(expression: "idle", temper: "lively", beat: 0, size: 48)?.count == 1)
        #expect(KnightEyes.moments(expression: "idle", temper: "lively", beat: 0, size: 120)?.count == 2)
    }
}
