#if os(macOS)
import SwiftUI

/// Settings (⌘,): This Mac (its node, when it is one; then this app's own device, forgotten from here), then Keys and
/// Connectors as tabs of their own, as a Mac's settings are.
struct MacSettings: View {
    let mac: MacApp

    var body: some View {
        TabView {
            Tab("This Mac", systemImage: ThisMacFoot.symbol) {
                NavigationStack {
                    if let session = mac.session {
                        MoreView(app: mac.app, session: session, places: false) { ThisMacSections(mac: mac) }
                    } else {
                        GroupedList {
                            ThisMacSections(mac: mac)
                            Section {
                                Text("This app isn't in a fleet yet: join it in Galahad's window, and its settings are here.").foregroundStyle(.secondary)
                            }
                        }
                        .navigationTitle("This Mac")
                    }
                }
            }
            if let session = mac.session, session.can("vault:read") {
                Tab("Keys", systemImage: "key") {
                    NavigationStack { KeysView(session: session) }
                }
            }
            if let session = mac.session, session.can("mind:read") {
                Tab("Connectors", systemImage: "point.3.connected.trianglepath.dotted") {
                    NavigationStack { ConnectorsView(session: session) }
                }
            }
        }
        .frame(width: 680, height: 620)
        .tint(.ink)
        .formStyle(.grouped)
        // This Mac is read again every few seconds while Settings is open.
        .task {
            while !Task.isCancelled {
                await mac.thisMac.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}
#endif
