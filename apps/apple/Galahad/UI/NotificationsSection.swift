import SwiftUI

/// Notifications on this iPhone: on and off, said plainly, and a test. What he tells you about and when he stays quiet
/// are the node's own settings, the same from every device (the web app's Settings, or `galahad notify`).
struct NotificationsSection: View {
    let session: Session
    /// Whether the node notifies this device (nil: not read yet).
    @State private var on: Bool?
    @State private var busy = false
    @State private var said: String?
    @State private var problem: String?

    private struct Status: Decodable { let subscribed: Bool? }
    private struct Kept: Decodable { struct Device: Decodable { let service: String }; let device: Device }
    private struct Removed: Decodable { let removed: Bool }
    private struct Sent: Decodable { struct Line: Decodable { let ok: Bool; let error: String? }; let sent: [Line] }
    private struct Nothing: Encodable {}

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { on ?? false }, set: { want in Task { await turn(want) } })) {
                Label("Notifications on this iPhone", systemImage: "bell")
            }
            .disabled(on == nil || busy)
            if on == true {
                Button("Send a test") { Task { await test() } }
                    .disabled(busy)
            }
            if let said { Text(said).font(.footnote).foregroundStyle(.secondary) }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
            }
        } header: {
            Text("Notifications")
        } footer: {
            Text("Galahad comes to you here when something needs you: an approval, a key he asked for, a question, work that ended while you were away. A notification never holds a key or a model's own words.")
        }
        .task { await load() }
    }

    private func load() async {
        do {
            on = try await session.client.get("/api/notify", as: Status.self).subscribed ?? false
        } catch {
            problem = error.localizedDescription
        }
    }

    private func turn(_ want: Bool) async {
        busy = true
        defer { busy = false }
        problem = nil
        said = nil
        do {
            if want {
                let token = try await PushCenter.shared.register()
                let kept = try await session.client.post("/api/notify/apple", ["token": token, "environment": PushCenter.shared.environment], as: Kept.self)
                on = true
                said = "On, through \(kept.device.service)'s push service."
            } else {
                _ = try await session.client.post("/api/notify/unsubscribe", Nothing(), as: Removed.self)
                on = false
            }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func test() async {
        busy = true
        defer { busy = false }
        problem = nil
        do {
            let line = try await session.client.post("/api/notify/test", Nothing(), as: Sent.self).sent.first
            said = line?.ok == true ? "Sent: it arrives in a moment." : nil
            if line?.ok != true { problem = "It didn't go: \(line?.error ?? "no reason given")." }
        } catch {
            problem = error.localizedDescription
        }
    }
}
