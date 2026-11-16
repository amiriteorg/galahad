#if os(macOS)
import Foundation
import ServiceManagement
import Testing
@testable import Galahad

/// A folder of a test's own, removed after it.
final class Scratch {
    let url = FileManager.default.temporaryDirectory.appending(path: "galahad-mac-tests-\(UUID().uuidString)")

    init() throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: url)
    }

    func write(_ text: String, to path: String, mode: Int = 0o600) throws -> URL {
        let file = url.appending(path: path)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: mode], ofItemAtPath: file.path)
        return file
    }
}

/**
 * The node inside the Mac app (docs/MAC.md, M2): what the app reads of its bundle, the node's home and its agent; the
 * bundled CLI on your PATH; and pairing with its own node. Nothing here registers the agent, runs the node's CLI, or
 * touches ~/.galahad or ~/.local/bin: each file is in a folder of the test's own.
 */
struct MacNodeTests {
    @Test func anAgentNotFoundIsAnAgentNotRegistered() {
        // Before its first registration an agent reads notFound (macOS 27.2): the same thing to the app.
        #expect(NodeAgent.state(.notFound) == .off)
        #expect(NodeAgent.state(.notRegistered) == .off)
        #expect(NodeAgent.state(.enabled) == .on)
        #expect(NodeAgent.state(.requiresApproval) == .needsApproval)
    }

    @Test func theAgentInTheAppIsTheOneTheAppRegisters() throws {
        let file = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../scripts/mac-node/\(NodeAgent.plist)")
        let plist = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: file), format: nil) as? [String: Any])
        #expect(plist["Label"] as? String == NodeAgent.label)
        #expect(NodeAgent.label == "sh.galahad.node", "install.sh's label, so a node it made isn't doubled")
        #expect(plist["BundleProgram"] as? String == "Contents/MacOS/Galahad")
        #expect(plist["ProgramArguments"] as? [String] == ["Galahad", "--serve-node"])
        #expect(plist["KeepAlive"] as? Bool == true)
        #expect(plist["RunAtLoad"] as? Bool == true)
    }

    @Test func launchdSaysTheNodesProcess() {
        let running = "gui/501/sh.galahad.node = {\n\tactive count = 1\n\tstate = running\n\n\targuments = {\n\t\tGalahad\n\t\t--serve-node\n\t}\n\n\tpid = 4242\n\timmediate reason = speculative\n}\n"
        #expect(NodeAgent.pid(in: running) == 4242)
        #expect(NodeAgent.pid(in: "gui/501/sh.galahad.node = {\n\tstate = not running\n\tlast exit code = 1\n}\n") == nil)
    }

    @Test func whenAProcessStartedIsTheKernelsWord() throws {
        let started = try #require(NodeAgent.started(getpid()))
        #expect(started <= .now && started > Date.now.addingTimeInterval(-3600))
        #expect(NodeAgent.started(-1) == nil)
    }

    @Test func theNodeRunsFromAnApplicationsFolderAlone() {
        let home = "/Users/owner"
        #expect(NodeBundle.place(of: "/Applications/Galahad.app", home: home) == .applications)
        #expect(NodeBundle.place(of: "/Users/owner/Applications/Galahad.app", home: home) == .applications)
        // A download opened where it was runs from a read-only copy macOS makes for it, gone at the next restart.
        #expect(NodeBundle.place(of: "/private/var/folders/q1/x/T/AppTranslocation/6A2F81C4/d/Galahad.app", home: home) == .translocated)
        #expect(NodeBundle.place(of: "/Volumes/Galahad/Galahad.app", home: home) == .diskImage)
        #expect(NodeBundle.place(of: "/Users/owner/Downloads/Galahad.app", home: home) == .elsewhere)
    }

    @Test func theNodesPathIsInstallShsAndTheCLIsKeepsYours() {
        #expect(NodeBundle.servicePath == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        #expect(NodeBundle.path(nil) == NodeBundle.servicePath)
        #expect(NodeBundle.path("/Users/owner/.local/bin:/usr/bin:/bin") == "/Users/owner/.local/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin")
    }

    @Test func aBuildWithoutTheNodeIsTheClientAlone() throws {
        let scratch = try Scratch()
        let bundle = NodeBundle(app: scratch.url.appending(path: "Galahad.app"))
        #expect(!bundle.carriesNode)
        #expect(bundle.revision == nil)
        _ = try scratch.write("#!/bin/sh\n", to: "Galahad.app/Contents/Helpers/bun", mode: 0o755)
        _ = try scratch.write("// the CLI\n", to: "Galahad.app/Contents/Resources/node/packages/node/src/cli.ts")
        #expect(!bundle.carriesNode, "no agent")
        _ = try scratch.write("<plist/>\n", to: "Galahad.app/Contents/Library/LaunchAgents/sh.galahad.node.plist")
        _ = try scratch.write("1572e2ec41b1a9d3bd6e0ef0a9dd6f1b65e0a2c7\n", to: "Galahad.app/Contents/Resources/node/REVISION")
        #expect(bundle.carriesNode)
        #expect(bundle.revision == "1572e2ec41b1a9d3bd6e0ef0a9dd6f1b65e0a2c7")
    }

    @Test func galahadOnYourPathIsTwoLinesThatRunTheBundledCLI() async throws {
        let scratch = try Scratch()
        // An app of the test's own, at a path with a space and a quote in it; its "Bun" says what it was given.
        let bundle = NodeBundle(app: scratch.url.appending(path: "Owner's Apps/Galahad.app"))
        _ = try scratch.write("#!/bin/sh\nprintf '%s\\n' \"$@\"\n", to: "Owner's Apps/Galahad.app/Contents/Helpers/bun", mode: 0o755)
        #expect(bundle.command.split(separator: "\n").count == 2)
        let file = scratch.url.appending(path: "bin/galahad")
        #expect(CommandOnPath.read(file, bundle: bundle) == .none)
        try CommandOnPath.write(file, bundle: bundle)
        #expect(CommandOnPath.read(file, bundle: bundle) == .ours)
        let mode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
        #expect(mode?.intValue == 0o755)
        let ran = try await Command.run(file, ["status", "two words"])
        #expect(ran.succeeded)
        #expect(ran.output == "\(bundle.cli.path)\nstatus\ntwo words\n")
    }

    @Test func aGalahadOnYourPathFromInstallShIsSeenAsAnothers() throws {
        let scratch = try Scratch()
        let file = try scratch.write("#!/bin/sh\n# Galahad (scripts/install.sh): the node in /Users/owner/.local/share/galahad.\nexec bun cli.ts \"$@\"\n", to: "galahad", mode: 0o755)
        #expect(CommandOnPath.read(file, bundle: NodeBundle(app: scratch.url.appending(path: "Galahad.app"))) == .another)
    }

    @Test func theNodesConfigIsReadAsTheNodeWritesIt() throws {
        let scratch = try Scratch()
        let home = NodeHome(dir: scratch.url)
        #expect(!home.exists)
        _ = try scratch.write("{\n  \"v\": 1,\n  \"name\": \"mini\",\n  \"fleet\": \"9mJ4uQ0vZx\",\n  \"port\": 7781,\n  \"keystore\": \"os\",\n  \"advertise\": null\n}\n", to: "config.json")
        #expect(home.exists)
        #expect(try home.config() == NodeHome.Config(name: "mini", fleet: "9mJ4uQ0vZx", port: 7781, keystore: "os", keepAwake: nil))
        _ = try scratch.write(#"{"v":1,"name":"mini","fleet":null,"port":7777,"keystore":"file","advertise":null,"keepAwake":true}"#, to: "config.json")
        #expect(try home.config().keepAwake == true)
        _ = try scratch.write("adm_test-not-a-real-credential\n", to: "admin.token")
        let admin = try LocalAdmin(home: home)
        #expect(admin.origin == URL(string: "http://127.0.0.1:7777"))
        #expect(admin.token == "adm_test-not-a-real-credential")
    }

    @Test func theAdminCredentialIsReadOnlyWhileItIsThisAccountsAlone() throws {
        let scratch = try Scratch()
        let home = NodeHome(dir: scratch.url)
        _ = try scratch.write("adm_test-not-a-real-credential\n", to: "admin.token", mode: 0o644)
        #expect(throws: NodeHome.Refused.self) { try home.adminToken() }
        _ = try scratch.write("adm_test-not-a-real-credential\n", to: "admin.token", mode: 0o640)
        #expect(throws: NodeHome.Refused.self) { try home.adminToken() }
        _ = try scratch.write("adm_test-not-a-real-credential\n", to: "admin.token", mode: 0o600)
        #expect(try home.adminToken() == "adm_test-not-a-real-credential")
        _ = try scratch.write("not a credential\n", to: "admin.token", mode: 0o600)
        #expect(throws: NodeHome.Refused.self) { try home.adminToken() }
    }

    @Test func theLogsTailIsItsLastWholeLines() throws {
        let scratch = try Scratch()
        let home = NodeHome(dir: scratch.url)
        #expect(home.tail() == "")
        _ = try scratch.write((1...5).map { "line \($0)\n" }.joined(), to: "logs/node.log")
        #expect(home.tail(2) == "line 4\nline 5")
        #expect(home.tail() == "line 1\nline 2\nline 3\nline 4\nline 5")
        // A long log is read from its end, and the line the read began inside isn't shown.
        _ = try scratch.write((1...20_000).map { "line \($0)\n" }.joined(), to: "logs/node.log")
        let tail = home.tail(100_000).split(separator: "\n")
        #expect(tail.last == "line 20000")
        #expect(tail.allSatisfy { $0.hasPrefix("line ") && Int($0.dropFirst(5)) != nil })
    }

    @Test func joiningsCodeIsReadFromWhatTheCLISays() {
        #expect(NodeSetup.code(in: "  Confirmation code:  482 913") == "482 913")
        #expect(NodeSetup.code(in: Command.plain("  Confirmation code:  \u{1B}[1m482 913\u{1B}[0m")) == "482 913")
        #expect(NodeSetup.code(in: "  Approve on the inviting node if it shows the same code. Waiting…") == nil)
    }

    @Test func thisMacIsNamedForItsShortHostName() {
        #expect(NodeSetup.defaultName(host: "Owners-Mac-mini.local") == "Owners-Mac-mini")
        #expect(NodeSetup.defaultName(host: "mini") == "mini")
        #expect(NodeSetup.defaultName(host: "mac mini (2).lan") == "mac-mini--2-")
        #expect(NodeSetup.defaultName(host: "Zoë_s-mini") == "Zo-_s-mini")
        #expect(NodeSetup.defaultName(host: String(repeating: "m", count: 60)) == String(repeating: "m", count: 40))
        #expect(NodeSetup.defaultName(host: "") == "mac")
    }

    @Test func aCommandIsRunToItsEndWithWhatItPrinted() async throws {
        let lines = Said()
        let ran = try await Command.run(URL(filePath: "/bin/sh"), ["-c", "echo one; echo two >&2; exit 3"]) { lines.add($0) }
        #expect(ran.status == 3)
        #expect(!ran.succeeded)
        #expect(ran.output == "one\ntwo\n")
        #expect(lines.all == ["one", "two"])
        #expect(ran.lastLine == "two")
    }

    @Test func aCommandCancelledIsStopped() async throws {
        let task = Task { try await Command.run(URL(filePath: "/bin/sleep"), ["30"]) }
        try await Task.sleep(for: .milliseconds(300))
        let cancelled = Date.now
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(Date.now.timeIntervalSince(cancelled) < 5)
    }

    @Test @MainActor func theFirstRunIsForAMacThatIsntANodeInAnAppThatIsntPaired() throws {
        let scratch = try Scratch()
        let suite = "org.amirite.galahad.tests.first-run.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let home = NodeHome(dir: scratch.url)
        #expect(FirstRun.wanted(paired: false, home: home, defaults: defaults))
        #expect(!FirstRun.wanted(paired: true, home: home, defaults: defaults))
        defaults.set("client", forKey: FirstRun.chosen)
        #expect(!FirstRun.wanted(paired: false, home: home, defaults: defaults), "just the app was chosen")
        defaults.removeObject(forKey: FirstRun.chosen)
        _ = try scratch.write(#"{"v":1,"name":"mini","fleet":null,"port":7777,"keystore":"os","advertise":null}"#, to: "config.json")
        #expect(!FirstRun.wanted(paired: false, home: home, defaults: defaults), "a node already")
    }

    @Test @MainActor func updatesStayOffUntilTheBuildCarriesItsKey() {
        #expect(!Updates(key: nil).available)
        #expect(!Updates(key: "").available)
        #expect(!Updates(key: " ").canCheck)
        // This build's own: the feed on galahad.sh, and no key yet (the owner makes it).
        #expect(Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String == "https://galahad.sh/mac/appcast.xml")
        #expect(Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String == "")
        #expect(!Updates.shared.available)
    }
}

/// Lines said by a command, as they came.
final class Said: @unchecked Sendable {
    private let lock = NSLock()
    private var lines: [String] = []
    func add(_ line: String) { lock.withLock { lines.append(line) } }
    var all: [String] { lock.withLock { lines } }
}

/// The app pairing with the node on its own Mac (SelfPairing): the invite is core's (the vectors'), and the node answers
/// as core's pairing host does, with the approval's proof core made.
struct SelfPairingTests {
    let pairing = Vectors.shared.pairing
    let origin = URL(string: "http://127.0.0.1:7777")!

    /// This Mac's node, to the app: its admin (the invite, the approval) and its pairing endpoints, keeping what happened in
    /// the order it happened.
    final class OwnNode: PairingAdmin, PairTransport, @unchecked Sendable {
        private let lock = NSLock()
        private let token: String
        private let sas: String
        private let approvedAnswer: String
        private var approved = false
        private var happened: [String] = []

        init(token: String, sas: String, fleet: String, approval: String) {
            (self.token, self.sas) = (token, sas)
            approvedAnswer = #"{"status":"approved","fleet":"\#(fleet)","approval":"\#(approval)"}"#
        }

        var said: [String] { lock.withLock { happened } }

        func clientInvite(origin: URL) async throws -> String {
            lock.withLock { happened.append("invite for \(origin.absoluteString)") }
            return token
        }

        func approve(invite: String, device: String) async throws {
            lock.withLock {
                happened.append("approve \(invite) \(device)")
                approved = true
            }
        }

        func post(_ path: String, _ body: [String: String]) async throws -> (status: Int, body: Data) {
            lock.withLock {
                happened.append(path)
                switch path {
                case "/link/pair/request": return (200, Data(#"{"status":"pending","sas":"\#(sas)"}"#.utf8))
                case "/link/pair/status": return (200, Data((approved ? approvedAnswer : #"{"status":"pending"}"#).utf8))
                default: return (404, Data(#"{"error":"not found"}"#.utf8))
                }
            }
        }
    }

    @Test func theAppAsksWithItsKeyThenApprovesItsOwnRequestAndChecksTheProof() async throws {
        let node = OwnNode(token: pairing.token, sas: pairing.sas, fleet: pairing.invite.f, approval: pairing.approvalProof)
        let paired = try await SelfPairing.pair(admin: node, origin: origin, transport: node, device: pairing.device, name: "Galahad app on mini")
        #expect(paired == PairedNode(origin: origin, device: pairing.device, name: "Galahad app on mini", fleet: pairing.invite.f))
        #expect(node.said == ["invite for http://127.0.0.1:7777", "/link/pair/request", "approve \(pairing.invite.i) \(pairing.device)", "/link/pair/status"])
    }

    @Test func aRequestTheNodeGaveAnotherCodeIsNeverApproved() async {
        let node = OwnNode(token: pairing.token, sas: "000 000", fleet: pairing.invite.f, approval: pairing.approvalProof)
        await #expect(throws: Joining.Stop.ended("The node computed a different code. Stopping here, to be safe.")) {
            try await SelfPairing.pair(admin: node, origin: origin, transport: node, device: pairing.device, name: "Galahad app on mini")
        }
        #expect(!node.said.contains { $0.hasPrefix("approve") })
    }

    @Test func anApprovalWithoutItsProofIsNotTrusted() async {
        let node = OwnNode(token: pairing.token, sas: pairing.sas, fleet: pairing.invite.f, approval: pairing.statusProof)
        await #expect(throws: Joining.Stop.ended("The approval could not be verified. Stopping here, to be safe.")) {
            try await SelfPairing.pair(admin: node, origin: origin, transport: node, device: pairing.device, name: "Galahad app on mini")
        }
    }
}

/// Staying on (StayingOn): each line read from what the Mac says, as macOS 27.2 says it, and what puts it right.
struct StayingOnTests {
    @Test func automaticLoginIsReadFromLoginwindowsPreferences() throws {
        let set = try PropertyListSerialization.data(fromPropertyList: ["autoLoginUser": "admin", "lastUserName": "admin"], format: .binary, options: 0)
        #expect(StayingOnReading.autoLoginUser(plist: set) == "admin")
        let unset = try PropertyListSerialization.data(fromPropertyList: ["lastUserName": "admin"], format: .xml, options: 0)
        #expect(StayingOnReading.autoLoginUser(plist: unset) == nil)
        #expect(StayingOnReading.autoLoginUser(plist: Data("not a plist".utf8)) == nil)
    }

    @Test func fileVaultIsReadForAfterTheNextRestart() {
        #expect(StayingOnReading.fileVault("FileVault is On.\n") == true)
        #expect(StayingOnReading.fileVault("FileVault is Off.\n") == false)
        #expect(StayingOnReading.fileVault("FileVault is Off, but will be enabled after the next restart.\n") == true)
        #expect(StayingOnReading.fileVault("") == nil)
    }

    @Test func aRestartAfterAPowerCutIsReadFromPmset() {
        let desktop = "System-wide power settings:\nCurrently in use:\n standby              0\n autorestart          1\n sleep                0\n"
        #expect(StayingOnReading.autorestart(pmset: desktop) == true)
        #expect(StayingOnReading.autorestart(pmset: desktop.replacingOccurrences(of: "autorestart          1", with: "autorestart          0")) == false)
        // A virtual Mac's (the VM's own, macOS 27.2) and a laptop's don't list it.
        let virtual = "System-wide power settings:\nCurrently in use:\n powernap             1\n sleep                0 (sleep prevented by powerd, runningboardd)\n Sleep On Power Button 1\n ttyskeepawake        1\n"
        #expect(StayingOnReading.autorestart(pmset: virtual) == nil)
    }

    @Test func tailscaleIsReadFromItsStatus() throws {
        let running = #"{"Version":"1.90.6","BackendState":"Running","Self":{"DNSName":"mini.example-tailnet.ts.net.","TailscaleIPs":["100.64.0.7","fd7a:115c:a1e0::7"]}}"#
        let status = try #require(StayingOnReading.tailscale(status: Data(running.utf8)))
        #expect(status.running && status.state == "Running" && status.name == "mini.example-tailnet.ts.net")
        let signedOut = try #require(StayingOnReading.tailscale(status: Data(#"{"BackendState":"NeedsLogin","Self":{"DNSName":""}}"#.utf8)))
        #expect(!signedOut.running && signedOut.state == "NeedsLogin" && signedOut.name == nil)
        #expect(StayingOnReading.tailscale(status: Data("tailscale: not running".utf8)) == nil)
    }

    @Test func whereGalahadIsPublishedIsReadAsTheNodeReadsIt() {
        let serve = #"{"TCP":{"443":{"HTTPS":true}},"Web":{"mini.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7778"}}}}}"#
        #expect(StayingOnReading.published(serve: Data(serve.utf8), proxyPort: 7778) == "https://mini.example-tailnet.ts.net")
        #expect(StayingOnReading.published(serve: Data(serve.utf8), proxyPort: 7780) == nil)
        let elsewhere = #"{"Web":{"mini.example-tailnet.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://localhost:7778/"}}}}}"#
        #expect(StayingOnReading.published(serve: Data(elsewhere.utf8), proxyPort: 7778) == "https://mini.example-tailnet.ts.net:8443")
        #expect(StayingOnReading.published(serve: Data("{}".utf8), proxyPort: 7778) == nil)
    }

    @Test func eachLineSaysWhatIsMissingAndWhatPutsItRight() {
        #expect(StayingOn.runsAtLogin(.on).holds == true)
        #expect(StayingOn.runsAtLogin(.needsApproval).fix == .loginItems)
        #expect(StayingOn.runsAtLogin(.off).fix == .runAtLogin)
        // FileVault on keeps a Mac at its login window after a restart, whatever loginwindow keeps.
        #expect(StayingOn.logsIn(autoLogin: "owner", me: "owner", fileVault: true).fix == .fileVault)
        #expect(StayingOn.logsIn(autoLogin: "owner", me: "owner", fileVault: false).holds == true)
        #expect(StayingOn.logsIn(autoLogin: "guest", me: "owner", fileVault: false).holds == false)
        #expect(StayingOn.logsIn(autoLogin: nil, me: "owner", fileVault: nil).fix == .usersAndGroups)
        #expect(StayingOn.staysAwake(set: true, held: true).holds == true)
        // Set, with the node not answering: it holds from the node's start.
        #expect(StayingOn.staysAwake(set: true, held: nil).holds == true)
        #expect(StayingOn.staysAwake(set: true, held: false).fix == .restart)
        #expect(StayingOn.staysAwake(set: false, held: nil).fix == .keepAwake)
        #expect(StayingOn.startsAfterPowerCut(true).holds == true)
        #expect(StayingOn.startsAfterPowerCut(false).fix == .energy)
        #expect(StayingOn.startsAfterPowerCut(nil).holds == nil)
        #expect(StayingOn.reachable(.absent).fix == .getTailscale)
        #expect(StayingOn.reachable(.noCommand).fix == .openTailscale)
        #expect(StayingOn.reachable(.off("NeedsLogin")).fix == .openTailscale)
        #expect(StayingOn.reachable(.on(name: "mini", published: nil)).fix == .publish)
        #expect(StayingOn.reachable(.on(name: "mini", published: "https://mini.example-tailnet.ts.net")).holds == true)
        let lines = StayingOn(lines: [StayingOn.runsAtLogin(.on), StayingOn.startsAfterPowerCut(nil), StayingOn.reachable(.absent)])
        #expect(lines.holding == 1)
    }
}
#endif
