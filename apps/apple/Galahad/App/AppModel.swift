import Foundation
import Observation

/// The node this device paired with, kept in the app's defaults. Nothing in it is secret: the key is in the Keychain.
struct PairedNode: Codable, Equatable, Sendable {
    /// Where the app reaches the node: the address the invite link was made for.
    var origin: URL
    var device: String
    /// What this device is called in the fleet.
    var name: String
    var fleet: String
    var nodeName: String?
    var fleetName: String?

    private static let key = "bot.galahad.paired-node"

    static func load(from defaults: UserDefaults = .standard) -> PairedNode? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(PairedNode.self, from: $0) }
    }

    func save(to defaults: UserDefaults = .standard) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Self.key)
    }

    static func forget(in defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}

/// Whether this device is paired, and with what: the app's one piece of state that outlives a launch.
@MainActor @Observable final class AppModel {
    enum Phase {
        case loading
        case unpaired
        case paired(Session)
        /// The Keychain couldn't be read: never taken for "no key", which would invite pairing over it.
        case broken(String)
    }

    private(set) var phase = Phase.loading

    func start() {
        do {
            guard let key = try DeviceKey.load(), let node = PairedNode.load(), node.device == key.device else {
                phase = .unpaired
                return
            }
            phase = .paired(Session(key: key, node: node))
        } catch {
            phase = .broken(error.localizedDescription)
        }
    }

    func paired(key: DeviceKey, node: PairedNode) {
        node.save()
        phase = .paired(Session(key: key, node: node))
    }

    /// Deletes this device's key. It can't be recovered: pairing again makes a new device, and the old one stays in
    /// the fleet's list until it is revoked there.
    func forget() throws {
        try DeviceKey.delete()
        PairedNode.forget()
        phase = .unpaired
    }
}
