import CryptoKit
import Foundation
import Security

/**
 * This device's identity: an ECDSA P-256 key that can sign but can never be read out, not even by this app. It is made
 * inside the Secure Enclave wherever there is one: every iPhone and iPad that runs iOS 26, and a simulator that emulates
 * one (Xcode's does on Apple silicon). Only where there is none is it a software key in the Keychain, and that one is
 * weaker: iOS hands a software key's bytes back to the app that made it, whatever kSecAttrIsExtractable says (measured:
 * DeviceKeyTests). Either way it is kept for this device only (never in a backup or iCloud Keychain), and the app holds
 * a reference to it, never its bytes. Its public key is the device id (`DeviceID`).
 */
final class DeviceKey: RequestSigner, @unchecked Sendable {
    // (Unchecked: a SecKey is an immutable reference the Security framework lets any thread use.)

    enum Storage: Sendable { case secureEnclave, keychain }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ what: String) { errorDescription = what }
        init(_ what: String, status: OSStatus) {
            errorDescription = "\(what) (\(SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"))"
        }
        init(_ what: String, error: Unmanaged<CFError>?) {
            errorDescription = "\(what) (\(error.map { $0.takeRetainedValue().localizedDescription } ?? "no reason given"))"
        }
    }

    /// The app's own key; tests use tags of their own.
    static let appTag = "bot.galahad.device-key"

    /// Where a new key is made: the Secure Enclave wherever there is one.
    static var preferred: Storage { SecureEnclave.isAvailable ? .secureEnclave : .keychain }

    let device: String
    /// Uncompressed: 0x04, x, y (65 bytes).
    let publicKey: Data
    let storage: Storage
    private let privateKey: SecKey

    private init(privateKey: SecKey) throws {
        var error: Unmanaged<CFError>?
        guard let publicKey = SecKeyCopyPublicKey(privateKey), let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw Failure("This device's key has no public key", error: error)
        }
        let attributes = SecKeyCopyAttributes(privateKey) as? [CFString: Any]
        self.privateKey = privateKey
        self.publicKey = raw
        self.device = DeviceID.client(publicKey: raw)
        self.storage = (attributes?[kSecAttrTokenID] as? String) == (kSecAttrTokenIDSecureEnclave as String) ? .secureEnclave : .keychain
    }

    /// This device's key, or nil when none was ever made. A Keychain that can't be read is an error, never "no key"
    /// (which would invite pairing over it).
    static func load(tag: String = appTag) throws -> DeviceKey? {
        try reference(tag: tag).map(DeviceKey.init(privateKey:))
    }

    /// A new key, kept under `tag`.
    static func create(tag: String = appTag, in storage: Storage = preferred) throws -> DeviceKey {
        var error: Unmanaged<CFError>?
        var key: [CFString: Any] = [kSecAttrIsPermanent: true, kSecAttrApplicationTag: Data(tag.utf8)]
        var attributes: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits: 256]
        if storage == .secureEnclave {
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, &error) else {
                throw Failure("Couldn't describe the key's access", error: error)
            }
            key[kSecAttrAccessControl] = access
            attributes[kSecAttrTokenID] = kSecAttrTokenIDSecureEnclave
        } else {
            key[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        }
        attributes[kSecPrivateKeyAttrs] = key
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw Failure("Couldn't make this device's key", error: error)
        }
        return try DeviceKey(privateKey: privateKey)
    }

    /// Forgets the key. It can't be recovered: pairing again makes a new one, a new device to the fleet.
    static func delete(tag: String = appTag) throws {
        let status = SecItemDelete(query(tag: tag) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure("Couldn't forget this device's key", status: status) }
    }

    /// The Keychain's reference to the private key under `tag`, or nil when there is none.
    static func reference(tag: String) throws -> SecKey? {
        var item: CFTypeRef?
        var lookup = query(tag: tag)
        lookup[kSecReturnRef] = true
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let item, CFGetTypeID(item) == SecKeyGetTypeID() else {
            throw Failure("Couldn't read this device's key", status: status)
        }
        return (item as! SecKey)
    }

    private static func query(tag: String) -> [CFString: Any] {
        [kSecClass: kSecClassKey, kSecAttrApplicationTag: Data(tag.utf8), kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass: kSecAttrKeyClassPrivate]
    }

    func sign(_ message: Data) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, message as CFData, &error) as Data? else {
            throw Failure("This device's key couldn't sign", error: error)
        }
        return try RequestAuth.rawSignature(fromDER: der)
    }
}
