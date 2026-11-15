import SwiftUI

/// `GET /api/secrets`: a key sealed in the vault, as far as anyone ever sees it: its name, where it may go, its last
/// four characters. Never its value.
struct SecretView: Decodable, Sendable, Identifiable, Equatable {
    let name: String
    let provider: String?
    let hint: String?
    /// The only origin this key is ever sent to (nil: pinned nowhere, so never used).
    let origin: String?
    let label: String?
    /// An HLC.
    let updatedAt: String
    let updatedBy: String
    var id: String { name }
}

/**
 * The vault, as this device may see it: every key sealed for your full nodes, each pinned to the one address it may
 * ever be sent to, its value never shown again and never seen by a model (the PWA's Vault). Add one, replace one (it
 * stays pinned where it was), or delete one by typing its name.
 */
struct KeysView: View {
    let session: Session
    @State private var keys: [SecretView]?
    @State private var unlocked = true
    @State private var problem: String?
    @State private var adding = false
    @State private var replacing: SecretView?
    @State private var deleting: SecretView?
    @State private var typed = ""

    var body: some View {
        List {
            Section {
                Label {
                    Text("Keys are sealed for your full nodes and nothing else: never kept on this phone, never shown again, never seen by a model. The node adds a key to a call itself, and only to the address it's pinned to.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "lock.shield").foregroundStyle(Color.ink)
                }
                if !unlocked {
                    Label("This node holds no vault grant yet, so it can't use these keys. Another full node can.", systemImage: "lock.trianglebadge.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(Color.siege)
                }
            }
            if let problem {
                Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
            }
            if let keys, !keys.isEmpty {
                Section("Sealed") {
                    ForEach(keys) { key in
                        KeyRow(key: key)
                            .swipeActions(edge: .trailing) {
                                if session.can("vault:write") {
                                    Button(role: .destructive) {
                                        typed = ""
                                        deleting = key
                                    } label: { Label("Delete", systemImage: "trash") }
                                    Button { replacing = key } label: { Label("Replace", systemImage: "arrow.triangle.2.circlepath") }
                                        .tint(.ink)
                                }
                            }
                            .contextMenu {
                                if session.can("vault:write") {
                                    Button { replacing = key } label: { Label("Replace its key", systemImage: "arrow.triangle.2.circlepath") }
                                    Button(role: .destructive) {
                                        typed = ""
                                        deleting = key
                                    } label: { Label("Delete…", systemImage: "trash") }
                                }
                            }
                    }
                }
            }
        }
        .navigationTitle("Keys")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add a key", systemImage: "plus") }
                    .disabled(!session.can("vault:write"))
            }
        }
        .overlay {
            if keys == nil, problem == nil {
                ProgressView()
            } else if keys?.isEmpty == true {
                ContentUnavailableView("No keys yet", systemImage: "key", description: Text("Add a provider's key or a service's, and it's sealed for every full node. Galahad asks for one he needs in your Inbox."))
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $adding) { AddKeySheet(session: session, replacing: nil) { await load() } }
        .sheet(item: $replacing) { key in AddKeySheet(session: session, replacing: key) { await load() } }
        .alert("Delete \(deleting?.name ?? "")?", isPresented: .init(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            TextField(deleting?.name ?? "", text: $typed)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Delete key", role: .destructive) { if let key = deleting { Task { await delete(key) } } }
                .disabled(typed != deleting?.name)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It's removed from the vault on every node, and what uses it stops working until you add a key again. This doesn't revoke it at its provider: do that there if it may have leaked. Type its name to delete it.")
        }
    }

    private func load() async {
        struct Listed: Decodable { let secrets: [SecretView]; let unlocked: Bool }
        do {
            let listed = try await session.client.get("/api/secrets", as: Listed.self)
            (keys, unlocked, problem) = (listed.secrets.sorted { $0.name < $1.name }, listed.unlocked, nil)
        } catch {
            problem = "The vault couldn't be read: \(error.localizedDescription)"
            if keys == nil { keys = [] }
        }
    }

    private func delete(_ key: SecretView) async {
        struct Delete: Encodable { let name: String }
        do {
            _ = try await session.client.post("/api/secrets/delete", Delete(name: key.name), as: JSONValue.self)
            await load()
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// A sealed key: its name, what it's for, and where it may ever go.
private struct KeyRow: View {
    let key: SecretView

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(key.name).font(.body.monospaced())
                if let hint = key.hint { Text(hint).font(.caption.monospaced()).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
            }
            if let label = key.label, !label.isEmpty { Text(label).font(.subheadline) }
            // Keys are pinned: shown so you can see exactly where this one may ever go.
            if let origin = key.origin {
                Text("only to \(origin.replacingOccurrences(of: "^https?://", with: "", options: .regularExpression))")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            } else {
                Text("pinned nowhere: never used").font(.caption).foregroundStyle(Color.siege)
            }
            if let at = hlcDate(key.updatedAt) {
                Text("Sealed \(at.formatted(.relative(presentation: .named)))").font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Sealing a key: its name, what it's for, where it may go, and the key itself in a secure field that's cleared before
/// anything is sent. Replacing one keeps its name, what it's for and where it's pinned.
private struct AddKeySheet: View {
    let session: Session
    let replacing: SecretView?
    let done: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var provider = ""
    @State private var address = ""
    @State private var label = ""
    @State private var value = ""
    @State private var sealing = false
    @State private var problem: String?

    private var nameOK: Bool { name.range(of: "^[A-Za-z0-9._:-]{1,128}$", options: .regularExpression) != nil }

    var body: some View {
        NavigationStack {
            Form {
                // The key first: it's what you came with, and it stays above the keyboard.
                Section {
                    // (No password content type: an API key is no password of yours for AutoFill to keep.)
                    SecureField("Paste the key", text: $value).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: {
                    Text("Key")
                } footer: {
                    Text("Sealed for your full nodes only: never kept on this phone, never shown again, never seen by a model.")
                }
                if let replacing {
                    Section {
                        LabeledContent("Name") { Text(replacing.name).font(.body.monospaced()) }
                        if let origin = replacing.origin { LabeledContent("Only to") { Text(origin).font(.footnote.monospaced()) } }
                    } footer: {
                        Text("The new key takes its place, pinned where the old one was.")
                    }
                } else {
                    Section {
                        TextField("e.g. anthropic", text: $name).font(.body.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: {
                        Text("Name")
                    } footer: {
                        Text("Letters, digits and . _ : - (a provider's or a connector's own name ties the key to it).")
                    }
                    Section {
                        TextField("A provider or a connector, e.g. openrouter", text: $provider).textInputAutocapitalization(.never).autocorrectionDisabled()
                        TextField("Only sent to, e.g. https://api.example.com", text: $address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: {
                        Text("What it's for")
                    } footer: {
                        Text("A built-in provider or connector pins it to its own address; give one only for your own service. A key pinned nowhere is never used.")
                    }
                    Section("Label") { TextField("e.g. personal account", text: $label) }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
            }
            .navigationTitle(replacing.map { "Replace \($0.name)" } ?? "Add a key")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Seal") { Task { await seal() } }
                        .disabled(value.isEmpty || sealing || (replacing == nil && !nameOK))
                }
            }
        }
    }

    private func seal() async {
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // The field is cleared before anything is sent: the key is never shown back.
        value = ""
        guard !key.isEmpty, !sealing else { return }
        struct Secret: Encodable { let name: String; let value: String; var provider: String?; var label: String?; var baseUrl: String? }
        let trimmed = { (text: String) -> String? in
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        let secret: Secret = if let replacing {
            // Pinned where it was: the address it was entered with is given again, so the node pins it there.
            Secret(name: replacing.name, value: key, provider: replacing.provider, label: replacing.label, baseUrl: replacing.origin)
        } else {
            Secret(name: name, value: key, provider: trimmed(provider), label: trimmed(label), baseUrl: trimmed(address))
        }
        sealing = true
        defer { sealing = false }
        do {
            _ = try await session.client.post("/api/secrets", secret, as: JSONValue.self)
            await done()
            dismiss()
        } catch {
            problem = "\(error.localizedDescription). Paste it again."
        }
    }
}
