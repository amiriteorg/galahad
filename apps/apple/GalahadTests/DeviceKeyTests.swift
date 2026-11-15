import CryptoKit
import Foundation
import Security
import Testing
@testable import Galahad

/// This device's key: made where it can't be read out, found again by its tag, signing as the node verifies. Each test
/// has a tag of its own, so none of them ever meets the app's own key.
@Suite(.serialized) struct DeviceKeyTests {
    let tag = "bot.galahad.tests.\(UUID().uuidString)"

    @Test func aNewKeyIsKeptAndFoundAgainByItsTag() throws {
        defer { try? DeviceKey.delete(tag: tag) }
        #expect(try DeviceKey.load(tag: tag) == nil)
        let key = try DeviceKey.create(tag: tag)
        #expect(key.publicKey.count == 65 && key.publicKey.first == 0x04)
        #expect(key.device == DeviceID.client(publicKey: key.publicKey))
        #expect(DeviceID.isClient(key.device))
        let again = try #require(try DeviceKey.load(tag: tag))
        #expect(again.device == key.device)
        #expect(again.storage == key.storage)
    }

    @Test func itSignsRawRAndSThatVerifyUnderItsPublicKey() throws {
        defer { try? DeviceKey.delete(tag: tag) }
        let key = try DeviceKey.create(tag: tag)
        let message = RequestAuth.signingInput(method: "GET", path: "/api/whoami", ts: "1763200000000", nonce: "AAAAAAAAAAAAAAAA", body: Data())
        let signature = try key.sign(message)
        #expect(signature.count == 64)
        let publicKey = try P256.Signing.PublicKey(x963Representation: key.publicKey)
        #expect(publicKey.isValidSignature(try P256.Signing.ECDSASignature(rawRepresentation: signature), for: message))
        #expect(!publicKey.isValidSignature(try P256.Signing.ECDSASignature(rawRepresentation: signature), for: message + Data([0])))
    }

    @Test(.enabled(if: SecureEnclave.isAvailable, "no Secure Enclave here, so no key can be made that can't be read out"))
    func itsPrivateKeyCantBeReadOutEvenByThisApp() throws {
        defer { try? DeviceKey.delete(tag: tag) }
        #expect(try DeviceKey.create(tag: tag).storage == .secureEnclave)
        #expect(try privateBytes(tag: tag) == nil, "the private key's bytes came back")
    }

    /// Why the key is made in the Secure Enclave: iOS hands a software key's bytes back to the app that made it, even one
    /// made with kSecAttrIsExtractable false. Should iOS ever refuse, this fails, and the fallback is as strong.
    @Test func aKeychainSoftwareKeyCanBeReadOutByItsApp() throws {
        defer { try? DeviceKey.delete(tag: tag) }
        #expect(try DeviceKey.create(tag: tag, in: .keychain).storage == .keychain)
        #expect(try privateBytes(tag: tag) != nil)
    }

    @Test func itIsMadeInTheEnclaveWhereThereIsOneAndKept() throws {
        defer { try? DeviceKey.delete(tag: tag) }
        _ = try DeviceKey.create(tag: tag)
        let reference = try #require(try DeviceKey.reference(tag: tag))
        let attributes = try #require(SecKeyCopyAttributes(reference) as? [CFString: Any])
        #expect(attributes[kSecAttrIsPermanent] as? Bool == true)
        #expect(try DeviceKey.load(tag: tag)?.storage == (SecureEnclave.isAvailable ? .secureEnclave : .keychain))
    }

    /// The private key's bytes, by either way out: its reference's export, or the Keychain item's data.
    private func privateBytes(tag: String) throws -> Data? {
        let reference = try #require(try DeviceKey.reference(tag: tag))
        var error: Unmanaged<CFError>?
        if let exported = SecKeyCopyExternalRepresentation(reference, &error) as Data?, !exported.isEmpty { return exported }
        _ = error?.takeRetainedValue()
        var item: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassKey,
            kSecAttrApplicationTag: Data(tag.utf8),
            kSecAttrKeyClass: kSecAttrKeyClassPrivate,
            kSecReturnData: true,
        ] as CFDictionary, &item)
        return status == errSecSuccess ? (item as? Data).flatMap { $0.isEmpty ? nil : $0 } : nil
    }

    @Test func deletingItLeavesNothingAndANewKeyIsAnotherDevice() throws {
        defer { try? DeviceKey.delete(tag: tag) }
        let first = try DeviceKey.create(tag: tag)
        try DeviceKey.delete(tag: tag)
        #expect(try DeviceKey.load(tag: tag) == nil)
        let second = try DeviceKey.create(tag: tag)
        #expect(second.device != first.device)
    }
}
