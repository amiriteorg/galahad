#if os(macOS)
import SwiftUI

/// Settings (⌘,): this Mac and its node (More's own page, forgetting the device with it), then Keys and Connectors as tabs
/// of their own, as a Mac's settings are.
struct MacSettings: View {
    let mac: MacApp

    var body: some View {
        Group {
            if let session = mac.session {
                TabView {
                    Tab("This Mac", systemImage: "laptopcomputer") {
                        NavigationStack { MoreView(app: mac.app, session: session, places: false) }
                    }
                    if session.can("vault:read") {
                        Tab("Keys", systemImage: "key") {
                            NavigationStack { KeysView(session: session) }
                        }
                    }
                    if session.can("mind:read") {
                        Tab("Connectors", systemImage: "point.3.connected.trianglepath.dotted") {
                            NavigationStack { ConnectorsView(session: session) }
                        }
                    }
                }
            } else {
                ContentUnavailableView("Not in a fleet yet", systemImage: "person.2.slash", description: Text("Join your fleet in Galahad's window: its settings are here once this Mac is in it."))
            }
        }
        .frame(width: 640, height: 560)
        .tint(.ink)
        .formStyle(.grouped)
    }
}
#endif
