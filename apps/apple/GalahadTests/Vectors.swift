import Foundation
@testable import Galahad

/// The test vectors `packages/core` makes (`scripts/vectors.ts`): what a node itself computes and verifies. Every key in
/// them is a fake made for these tests.
struct Vectors: Decodable {
    struct Auth: Decodable {
        let domain: String
        let headers: [String: String]
        let maxSkewMs: Int
    }

    struct Base64URLCases: Decodable {
        struct Encoded: Decodable { let hex: String; let b64u: String }
        struct Decoded: Decodable { let text: String; let hex: String? }
        let encode: [Encoded]
        let decode: [Decoded]
    }

    struct Identity: Decodable {
        let scalarHex: String
        let publicKey: String
        let device: String
    }

    struct Request: Decodable {
        let method: String
        let path: String
        let ts: String
        let nonce: String
        let body: String
        let bodySha256: String
        let signingInput: String
        let signature: String
        let signatureHighS: String
        let signatureDer: String
        let headers: [String: String]
    }

    struct Canonical: Decodable {
        let value: [String: String]
        let canonical: String
    }

    struct Pairing: Decodable {
        struct Decode: Decodable { let text: String; let invite: Invite? }
        struct Proof: Decodable { let name: String; let canonical: String; let proof: String }
        struct Code: Decodable { let fleet: String; let device: String; let sas: String }
        let secretText: String
        let invite: Invite
        let token: String
        let url: String
        let decode: [Decode]
        let device: String
        let proofs: [Proof]
        let sas: String
        let codes: [Code]
        let statusProof: String
        let approvalProof: String
    }

    struct Look: Decodable {
        let id: String
        let name: String
        let avatar: JSONValue?
        let look: String
    }

    struct Roundtable: Decodable {
        struct Row: Decodable { let id: String; let line: String; let needs: Bool }
        struct Now: Decodable { let input: GalahadWork; let text: String; let tone: String }
        struct Needs: Decodable { let inbox: Int; let knights: [String]; let needs: Int }
        let snapshot: TeamSnapshot
        let asks: [Ask]
        let rows: [Row]
        let galahad: [Now]
        let needs: [Needs]
    }

    struct Rooms: Decodable {
        struct Row: Decodable { let id: String; let line: String; let needs: Bool }
        let snapshot: TeamSnapshot
        let rows: [Row]
    }

    struct KnightForms: Decodable {
        struct Handle: Decodable { let name: String; let taken: [String]; let handle: String }
        struct Removal: Decodable {
            struct Plan: Decodable { let blocked: String?; let lines: [String]; let destroyWorkspace: Bool }
            let id: String
            let name: String
            let workspace: Bool
            let workspaceNode: Bool
            let maySandbox: Bool
            let plan: Plan
        }
        struct Profile: Decodable { let look: String; let temperament: String; let profile: AvatarProfile }
        struct Temperament: Decodable { let id: String; let avatar: JSONValue?; let temperament: String }
        let handles: [Handle]
        let removals: [Removal]
        let profiles: [Profile]
        let temperaments: [Temperament]
    }

    struct Thread: Decodable {
        struct Turn: Decodable, Equatable {
            let role: String
            let content: String
            let status: String
            let error: String?
            let sid: Int?
            let steps: [Step]
        }

        struct Step: Decodable, Equatable {
            let text: String
            let detail: String?
            let state: String
            let tool: String?
        }

        let name: String
        let role: String
        let messages: [StoredMessage]
        let question: String?
        /// Each a stream event; null: the stream ends; a string: the watching was cut with it.
        let events: [JSONValue]
        let turns: [Turn]
    }

    struct ChatList: Decodable {
        struct Group: Decodable { let label: String; let ids: [String] }
        struct State: Decodable {
            let state: String
            let queued: Int
            let held: String?
            let needs: ConversationSummary.Needs?
            let words: String
        }

        let now: Double
        let list: [ConversationSummary]
        let groups: [Group]
        let states: [State]
    }

    struct MarkdownCase: Decodable {
        let source: String
        /// The PWA's tree for it, as lib/markdown.ts writes it ({t: "p", c: […]}, …).
        let blocks: [JSONValue]
    }

    struct BlockCases: Decodable {
        /// Core's answer: { ok: true, value } or { ok: false, why }.
        enum Read<T: Decodable & Sendable>: Decodable, Sendable {
            case ok(T)
            case no(String)
            private enum Keys: String, CodingKey { case ok, value, why }
            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: Keys.self)
                self = try c.decode(Bool.self, forKey: .ok) ? .ok(try c.decode(T.self, forKey: .value)) : .no(try c.decode(String.self, forKey: .why))
            }
        }

        struct Chart: Decodable {
            struct Series: Decodable { let name: String; let values: [Double?] }
            let type: String
            let title: String?
            let unit: String?
            let labels: [String]
            let series: [Series]
        }

        struct Stat: Decodable {
            let label: String
            let value: JSONValue
            let unit: String?
            let delta: Double?
            let note: String?
            let good: String?
        }

        struct Step: Decodable { let text: String; let state: String }
        struct Case<T: Decodable & Sendable>: Decodable, Sendable { let text: String; let read: Read<T> }
        struct Page: Decodable {
            /// The page, or (past the size limit) how many x's its paragraph holds.
            let text: String?
            let xs: Int?
            let ok: Bool
            let why: String?
            let title: String?
            var page: String { text ?? "<p>\(String(repeating: "x", count: xs ?? 0))</p>" }
        }
        struct Number: Decodable { let n: Double; let text: String }

        let charts: [Case<Chart>]
        let stats: [Case<[Stat]>]
        let choices: [Case<[String]>]
        let steps: [Case<[Step]>]
        let artifacts: [Page]
        let numbers: [Number]
    }

    struct Timelines: Decodable {
        struct Card: Decodable {
            struct Badge: Decodable { let text: String; let tone: String }
            struct End: Decodable { let why: String?; let said: String? }
            let id: String
            let badge: Badge
            let end: End?
            let actions: [String]
            let given: String?
            let kept: String?
            let proposed: String?
        }

        let messages: [TeamMessage]
        let tasks: [TeamTask]
        /// The timeline's keys: a knight's own room, a shared one, and the words since a moment.
        let knight: [String]
        let room: [String]
        let sinceAt: Double
        let since: [String]
        let speakers: [String]
        let cards: [Card]
    }

    let auth: Auth
    let base64url: Base64URLCases
    let identity: Identity
    let requests: [Request]
    let canonical: [Canonical]
    let pairing: Pairing
    let looks: [Look]
    let roundtable: Roundtable
    let rooms: Rooms
    let knightForms: KnightForms
    let threads: [Thread]
    let chats: ChatList
    let markdown: [MarkdownCase]
    let blocks: BlockCases
    let timelines: Timelines

    static let shared: Vectors = {
        guard let url = Bundle(for: BundleToken.self).url(forResource: "core-vectors", withExtension: "json") else {
            fatalError("core-vectors.json isn't in the test bundle: run bun apps/apple/scripts/vectors.ts")
        }
        do {
            return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        } catch {
            fatalError("core-vectors.json doesn't decode: \(error)")
        }
    }()
}

private final class BundleToken {}

extension Data {
    /// Bytes from lowercase or uppercase hex; nil when it isn't hex.
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2) else { return nil }
        var bytes = [UInt8]()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }

    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
