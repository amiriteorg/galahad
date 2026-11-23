import Foundation
import Testing
@testable import Galahad

/// Galahad's orb, as the PWA draws it (`lib/orb.ts`): the same colours and the same parts at every size, checked against
/// its own output.
struct OrbTests {
    let orb = Vectors.shared.orb

    @Test func eachStatesColoursAreThePWAs() {
        #expect(Set(Orb.Tone.allCases.map(\.rawValue)) == Set(orb.palettes.keys))
        for tone in Orb.Tone.allCases {
            let theirs = orb.palettes[tone.rawValue]
            #expect(Orb.palette(tone) == theirs.map { Orb.Palette(tint: $0.tint, light: $0.light, deep: $0.deep) }, "\(tone)")
        }
    }

    @Test func eachLevelIsDrawnFromThePWAsParts() {
        #expect(Set(orb.levels.keys) == ["badge", "seat", "full"])
        for (level, parts) in orb.levels {
            let size: Double = level == "badge" ? 28 : level == "seat" ? 64 : 168
            #expect(Orb.parts(size).map(\.name) == parts.map(\.name), "\(level)")
            #expect(Orb.parts(size) == parts.map(Self.part), "\(level)")
        }
    }

    @Test func eachSizeShowsAsMuchOfHimAsThePWAs() {
        for item in orb.sizes { #expect(Orb.level(item.size).rawValue == item.level, "\(item.size)") }
    }

    @Test func hisLinesToneIsHisOrbs() {
        let tones: [GalahadNow.Tone] = [.neutral, .accent, .warn, .ok]
        #expect(tones.map { Orb.Tone($0) } == [.neutral, .accent, .warn, .ok])
    }

    @Test func whereHeStandsIsHisSeatsColourAsThePWAs() {
        for item in orb.states {
            #expect(Standing(rawValue: item.state).map { Orb.Tone($0).rawValue } == item.tone, "\(item.state)")
        }
    }

    /// A part as lib/orb.ts wrote it, as the app's own (what it doesn't carry is NaN, which equals nothing).
    private static func part(_ given: Vectors.OrbCases.Part) -> Orb.Part {
        let number = { (value: Double?) in value ?? .nan }
        let ink = { (name: String?) in Orb.Ink(rawValue: name ?? "") ?? .white }
        let stops = (given.stops ?? []).map { Orb.Stop(at: $0.at, ink: ink($0.ink), opacity: $0.opacity) }
        let point = { (xy: [Double]?) in Orb.Point(x: xy?.first ?? .nan, y: xy?.last ?? .nan) }
        let kind: Orb.Kind = switch given.kind {
        case "disc": .disc(r: number(given.r), cx: number(given.cx), cy: number(given.cy), spread: number(given.spread), stops: stops)
        case "ring": .ring(r: number(given.r), width: number(given.width), ink: ink(given.ink), opacity: number(given.opacity), arcs: given.arcs.map { $0.map { Orb.Arc(from: $0.first ?? .nan, to: $0.last ?? .nan) } })
        case "ticks": .ticks(r: number(given.r), count: given.count ?? -1, offset: number(given.offset), length: number(given.length), width: number(given.width), ink: ink(given.ink), opacity: number(given.opacity))
        case "rim": .rim(r: number(given.r), width: number(given.width), from: point(given.from), to: point(given.to), stops: stops)
        default: .shine(cx: number(given.cx), cy: number(given.cy), rx: number(given.rx), ry: number(given.ry), rotate: number(given.rotate), opacity: number(given.opacity))
        }
        return Orb.Part(name: given.name, kind: kind)
    }
}
