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

    let auth: Auth
    let base64url: Base64URLCases
    let identity: Identity
    let requests: [Request]

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
