import SwiftUI

/// This device and its node: what it is called, where its key is kept, what it may do; and forgetting it.
struct MoreView: View {
    let app: AppModel
    let session: Session
    /// Keys and Connectors as places of their own, opened from here (not in a Mac's Settings, where they are tabs).
    var places = true
    @State private var forgetting = false
    @State private var problem: String?

    var body: some View {
        GroupedList {
            Section("This device") {
                LabeledContent("Name", value: session.node.name)
                LabeledContent("Device") { Text(String(session.key.device.dropFirst(2).prefix(8))).font(.body.monospaced()) }
                LabeledContent("Key", value: session.key.storage == .secureEnclave ? "In the Secure Enclave" : "In the Keychain")
                if let scopes = session.whoami?.scopes {
                    LabeledContent("May") { Text(scopes.joined(separator: ", ")).font(.footnote.monospaced()).multilineTextAlignment(.trailing) }
                }
            }
            #if os(iOS)
            if session.can("mind:read") {
                NotificationsSection(session: session)
            }
            #endif
            if places, session.can("vault:read") {
                Section {
                    NavigationLink { KeysView(session: session) } label: {
                        Label("Keys", systemImage: "key")
                    }
                } footer: {
                    Text("Sealed for your full nodes, each pinned to the one address it may go to; no model ever sees one.")
                }
            }
            if places, session.can("mind:read") {
                Section {
                    NavigationLink { ConnectorsView(session: session) } label: {
                        Label("Connectors", systemImage: "point.3.connected.trianglepath.dotted")
                    }
                } footer: {
                    Text("Your services, reached through Galahad's oath: what's sent out or deleted asks you first.")
                }
            }
            Section("Its node") {
                LabeledContent("Node", value: session.whoami?.nodeName ?? session.node.nodeName ?? "—")
                LabeledContent("Fleet", value: session.whoami?.fleetName ?? session.node.fleetName ?? "—")
                LabeledContent("Address") { Text(session.node.origin.absoluteString).font(.footnote.monospaced()) }
            }
            Section {
                Button("Forget this device", role: .destructive) { forgetting = true }
            } footer: {
                Text("Deletes this device's key, which can't be recovered: pairing again makes a new device. Revoke the old one on your node too.")
            }
            if let problem {
                Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
            }
            Section {
                LabeledContent("Version", value: Self.version)
            }
        }
        .navigationTitle(places ? "More" : "This \(ThisDevice.kind)")
        .confirmationDialog("Forget this device?", isPresented: $forgetting, titleVisibility: .visible) {
            Button("Forget this device", role: .destructive) {
                do {
                    try app.forget()
                } catch {
                    problem = error.localizedDescription
                }
            }
        } message: {
            Text("Its key is deleted and can't be brought back.")
        }
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
    }
}
