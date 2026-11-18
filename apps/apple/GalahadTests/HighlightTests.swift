import Testing
@testable import Galahad

/// Code is coloured here as the PWA colours it (lib/highlight.ts, through the vectors).
struct HighlightTests {
    @Test func eachSampleIsColouredAsThePWAColoursIt() {
        for sample in Vectors.shared.highlights {
            let pieces = Highlight.pieces(sample.code, lang: sample.lang)
            #expect(pieces.map(\.text) == sample.pieces.map(\.text), "\(sample.lang): \(sample.code)")
            #expect(pieces.map { $0.tone?.rawValue } == sample.pieces.map(\.tone), "\(sample.lang): \(sample.code)")
            // Nothing is ever lost or added.
            #expect(pieces.map(\.text).joined() == sample.code)
        }
        #expect(Vectors.shared.highlights.count >= 16)
    }
}
