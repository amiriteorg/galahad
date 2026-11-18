import Testing
@testable import Galahad

/// The meter's words, as the node's own say money and tokens (core's spend.ts: usdLabel, tokensLabel).
struct UsageTests {
    private func meter(spent: Double, budget: Double?, left: Double?, complete: Bool = true, per: String = "month") -> UsageMeter {
        UsageMeter(per: per, since: "2026-11-01", budgetUsd: budget, spentUsd: spent, complete: complete, unpriced: [], tokens: 3_610_000, calls: 3, leftUsd: left, top: [])
    }

    @Test func moneyAndTokensReadAsTheNodesDo() {
        #expect(Usage.usd(0) == "$0")
        #expect(Usage.usd(0.005) == "$0.0050")
        #expect(Usage.usd(3.4) == "$3.40")
        #expect(Usage.usd(10) == "$10.0")
        #expect(Usage.usd(150) == "$150")
        #expect(Usage.tokens(9_999) == "9,999")
        #expect(Usage.tokens(48_210) == "48.2k")
        #expect(Usage.tokens(2_340_000) == "2.34M")
    }

    @Test func theLineSaysWhatIsLeftOrThatItIsSpent() {
        #expect(Usage.line(meter(spent: 3.4, budget: 10, left: 6.6, complete: false)) == "at least $3.40 of $10.0 · $6.60 left")
        #expect(Usage.line(meter(spent: 2.1, budget: 2, left: 0)) == "$2.10 of $2.00 · spent")
        #expect(Usage.line(meter(spent: 3.4, budget: nil, left: nil)) == "$3.40 · 3.61M tokens")
        // Nothing priced yet is $0, never "at least $0".
        #expect(Usage.line(meter(spent: 0, budget: nil, left: nil, complete: false)) == "$0 · 3.61M tokens")
        #expect(Usage.share(meter(spent: 15, budget: 10, left: 0)) == 1)
        #expect(Usage.share(meter(spent: 3, budget: nil, left: nil)) == nil)
    }
}
