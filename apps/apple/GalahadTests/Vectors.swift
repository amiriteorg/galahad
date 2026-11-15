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

    let auth: Auth
    let base64url: Base64URLCases
    let identity: Identity
    let requests: [Request]
    let canonical: [Canonical]
    let pairing: Pairing
    let looks: [Look]
    let roundtable: Roundtable

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
