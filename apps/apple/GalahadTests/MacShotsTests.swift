#if os(macOS)
import AppKit
import Foundation
import ScreenCaptureKit
import SwiftUI
import Testing
@testable import Galahad

/// A dev node to pair with, and a folder for the pictures, were given.
private let shotsAsked = ProcessInfo.processInfo.environment["GALAHAD_DEV_NODE"] != nil && ProcessInfo.processInfo.environment["GALAHAD_SHOTS"] != nil

/**
 * The Mac app as it looks, in pictures, as the PWA's `measure/first-load.ts --shots` takes its own: the main window at the
 * Roundtable, a knight and Galahad's chat, Settings, and the Roundtable in the menu bar, in light and dark. Run only when
 * asked, against a fresh throwaway node (`scripts/dev-node.ts`, which lets one app in): it pairs as you would, the two
 * codes compared before it approves, then pictures the app's own windows as the window server draws them (an app may
 * picture its own windows without being let record the screen). It leaves no key behind.
 *
 *   bun apps/apple/scripts/dev-node.ts --dir /tmp/galahad-mac-shots
 *   TEST_RUNNER_GALAHAD_DEV_NODE=/tmp/galahad-mac-shots TEST_RUNNER_GALAHAD_SHOTS=/tmp/shots \
 *     xcodebuild -scheme GalahadMac -destination 'platform=macOS' -derivedDataPath build test -only-testing:GalahadMacTests/MacShots
 */
@MainActor @Suite(.serialized, .enabled(if: shotsAsked, "takes pictures only when asked, against a dev node"))
struct MacShots {
    let node = URL(fileURLWithPath: ProcessInfo.processInfo.environment["GALAHAD_DEV_NODE"] ?? "/nonexistent")
    let shots = URL(fileURLWithPath: ProcessInfo.processInfo.environment["GALAHAD_SHOTS"] ?? "/nonexistent")

    @Test(.timeLimit(.minutes(5))) func theMacAsItLooks() async throws {
        try FileManager.default.createDirectory(at: shots, withIntermediateDirectories: true)
        let tag = "org.amirite.galahad.tests.shots.\(UUID().uuidString)"
        defer {
            try? DeviceKey.delete(tag: tag)
            PairedNode.forget()
            NSApp.appearance = nil
        }
        let main = try window { $0.identifier?.rawValue.hasPrefix(MacApp.main) == true }
        main.setContentSize(NSSize(width: 1280, height: 800))
        // Joining, with a `galahad:` link's invite filled in.
        MacApp.shared.handed = try String(contentsOf: node.appending(path: "invite.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        for (look, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            NSApp.appearance = NSAppearance(named: appearance)
            try await Task.sleep(for: .seconds(1.5))
            try await snap(main, "join-\(look)")
        }
        NSApp.appearance = nil

        let session = try await pair(tag: tag)
        try await until(30) { session.team != nil && session.inboxLoaded }

        // Galahad asked to show what he found: the stand-in's answer holds everything an answer can.
        session.chat.draft = "Show me where the release stands"
        session.chat.send(with: session.client)
        try await until(60) { !session.chat.answering && session.chat.thread.turns.count >= 2 }
        // In front, as you would see it (a window behind another is drawn dimmed). macOS doesn't let an app put itself in
        // front, but Settings opened from its menu comes in front, and the app with it.
        try await openSettings().close()
        main.makeKeyAndOrderFront(nil)

        for (look, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            NSApp.appearance = NSAppearance(named: appearance)
            for (place, name) in [(MacPlace.roundtable, "roundtable"), (.knight("ada"), "knight"), (.galahad, "chat"), (.inbox, "inbox")] {
                MacApp.shared.place = place
                try await Task.sleep(for: .seconds(3))
                try await snap(main, "main-\(name)-\(look)")
            }
            // ⌘K: a task for the Roundtable.
            MacApp.shared.giving = true
            try await Task.sleep(for: .seconds(2))
            try await snap(try #require(main.attachedSheet), "give-\(look)")
            MacApp.shared.giving = false
            try await Task.sleep(for: .seconds(1))
            let settings = try await openSettings()
            try await snap(settings, "settings-\(look)")
            settings.close()
            main.makeKeyAndOrderFront(nil)
            // The menu bar's mark, and the panel it opens.
            let bar = try window { $0.isVisible && $0.contentView.flatMap(statusButton) != nil }
            let button = try #require(bar.contentView.flatMap(statusButton))
            try draw(button, "menu-bar-mark-\(look)")
            // What the mark opens, as the app draws it, on the menu's own material: in a panel of this test's, since SwiftUI
            // fills its own panel only for a click on the mark, which can't be made from inside the app.
            let panel = menuPanel()
            try await Task.sleep(for: .seconds(2))
            try await snap(panel, "menu-bar-\(look)")
            panel.orderOut(nil)
        }
        // ⌘N: a new chat, its message box holding the keys.
        NSApp.appearance = NSAppearance(named: .aqua)
        MacApp.shared.newChat()
        try await Task.sleep(for: .seconds(2))
        #expect(!MacApp.shared.composerWanted, "the new chat's message box didn't take the keys")
        try await snap(main, "main-new-chat-light")
    }

    /// Pairs as you would with the dev node's invite: asks, compares the node's code with this Mac's, then approves.
    private func pair(tag: String) async throws -> Session {
        let link = try String(contentsOf: node.appending(path: "invite.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let invite = try Invite.decode(link)
        let origin = try #require(Joining.origin(for: link, invite: invite))
        let key = try DeviceKey.create(tag: tag)
        let joining = Joining(invite: invite, device: key.device, transport: NodePairTransport(origin: origin))
        try await joining.ask(name: "Galahad app on Mac")
        let shown = node.appending(path: "pairing.txt")
        try await until(10) { FileManager.default.fileExists(atPath: shown.path) }
        let code = try String(contentsOf: shown, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        try #require(code == joining.code, "the node shows another code: not approved")
        try code.filter(\.isNumber).write(to: node.appending(path: "approve"), atomically: true, encoding: .utf8)
        try await joining.approval()
        let me = try? await NodeClient(origin: origin, signer: key).get("/api/whoami", as: WhoAmI.self)
        MacApp.shared.app.paired(key: key, node: PairedNode(origin: origin, device: key.device, name: "Galahad app on Mac", fleet: invite.f, nodeName: me?.nodeName, fleetName: me?.fleetName))
        return try #require(MacApp.shared.session)
    }

    /// Settings, opened as a click on Settings… in the app's menu opens it.
    private func openSettings() async throws -> NSWindow {
        let appMenu = try #require(NSApp.mainMenu?.items.first?.submenu)
        let item = try #require(appMenu.items.firstIndex { $0.keyEquivalent == "," })
        appMenu.performActionForItem(at: item)
        try await Task.sleep(for: .seconds(2))
        return try window { $0.identifier?.rawValue.localizedStandardContains("settings") == true }
    }

    private func menuPanel() -> NSPanel {
        let content = NSHostingView(rootView: MenuBarRoundtable(mac: MacApp.shared))
        let size = content.fittingSize
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        let material = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        (material.material, material.blendingMode, material.state) = (.menu, .behindWindow, .active)
        material.wantsLayer = true
        material.layer?.cornerRadius = Metrics.innerRadius
        material.layer?.masksToBounds = true
        content.frame = material.bounds
        content.autoresizingMask = [.width, .height]
        material.addSubview(content)
        panel.contentView = material
        (panel.isOpaque, panel.backgroundColor, panel.hasShadow) = (false, .clear, true)
        if let screen = NSScreen.main {
            panel.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.maxX - size.width - 80, y: screen.visibleFrame.maxY - 8))
        }
        panel.orderFrontRegardless()
        return panel
    }

    private func until(_ seconds: Double, _ done: () -> Bool) async throws {
        let end = Date.now.addingTimeInterval(seconds)
        while !done() {
            try #require(Date.now < end, "waited \(seconds) s")
            try await Task.sleep(for: .milliseconds(100))
        }
    }

    private func window(_ which: (NSWindow) -> Bool) throws -> NSWindow {
        let found = NSApp.windows.first(where: which)
        let among = NSApp.windows.map { "\($0.className) \($0.identifier?.rawValue ?? "-")" }
        return try #require(found, "no such window among \(among)")
    }

    private func statusButton(in view: NSView) -> NSStatusBarButton? {
        if let button = view as? NSStatusBarButton { return button }
        return view.subviews.lazy.compactMap(statusButton).first
    }

    /// A window as the window server draws it, glass and all: one of this app's own, which it may picture without being let
    /// record the screen.
    private func snap(_ window: NSWindow, _ name: String) async throws {
        let id = try #require(CGWindowID(exactly: window.windowNumber), "\(window.className) isn't one of the window server's")
        let content = try await SCShareableContent.currentProcess
        let shown = try #require(content.windows.first { $0.windowID == id }, "the window server doesn't list this window")
        let filter = SCContentFilter(desktopIndependentWindow: shown)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(filter.contentRect.width * CGFloat(filter.pointPixelScale))
        configuration.height = Int(filter.contentRect.height * CGFloat(filter.pointPixelScale))
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        try #require(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])).write(to: shots.appending(path: "\(name).png"))
    }

    /// A view as it draws itself: the menu bar's mark, whose window the menu bar's own process holds.
    private func draw(_ view: NSView, _ name: String) throws {
        let rep = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: rep)
        try #require(rep.representation(using: .png, properties: [:])).write(to: shots.appending(path: "\(name).png"))
    }
}
#endif
