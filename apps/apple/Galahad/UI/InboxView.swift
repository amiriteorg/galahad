import SwiftUI

/// Everything that needs you, in one place (the PWA's Inbox): devices asking to join, calls Galahad's oath made him ask
/// your leave for, and keys he asked for. Nothing here happens without your say.
struct InboxView: View {
    let session: Session
    @State private var open: ActionView?

    var body: some View {
        List {
            if !session.pairings.isEmpty {
                Section {
                    ForEach(session.pairings) { pairing in
                        JoinRequestRow(session: session, pairing: pairing)
                    }
                } header: {
                    Text("Devices asking to join")
                } footer: {
                    Text("Let one in only if it shows the same code.")
                }
            }
            if !session.waiting.isEmpty {
                Section {
                    ForEach(session.waiting) { action in
                        Button { open = action } label: { ApprovalRow(action: action) }
                            .tint(.primary)
                    }
                } header: {
                    Text("Waiting for your approval")
                } footer: {
                    Text("Nothing leaves until you approve it. Unanswered, it's a no.")
                }
            }
            if !session.requests.isEmpty {
                Section {
                    ForEach(session.requests) { request in
                        KeyRequestRow(session: session, request: request)
                    }
                } header: {
                    Text("Keys Galahad asked for")
                } footer: {
                    Text("He'll learn that a key exists, never what it is.")
                }
            }
        }
        .overlay {
            if !session.inboxLoaded {
                ProgressView()
            } else if session.inboxCount == 0 {
                ContentUnavailableView("Nothing needs you", systemImage: "checkmark.circle", description: Text("Approvals, keys Galahad asks for and devices asking to join wait here."))
            }
        }
        .navigationTitle("Inbox")
        .refreshable { await session.refresh() }
        .sheet(item: $open) { action in
            ApprovalSheet(session: session, action: action)
        }
    }
}

/// An approval in a line: what it calls, why, who asked, and until when.
struct ApprovalRow: View {
    let action: ActionView

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: Approval.symbol(action.kind))
                .font(.title3)
                .foregroundStyle(Color.siege)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(action.connector).\(action.tool)").font(.headline.monospaced())
                if let why = action.why, !why.isEmpty { Text(why).font(.subheadline) }
                Text("Asked by \(Approval.askedBy(action.by)) · expires \(Text(Date(timeIntervalSince1970: action.expires / 1000), style: .relative))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// An approval in full: what it sends and where, who asked and why. Approving asks once more, and a delete is approved
/// only by typing what it deletes.
struct ApprovalSheet: View {
    let session: Session
    let action: ActionView
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false
    @State private var typed = ""
    @State private var busy = false
    @State private var problem: String?

    private var destructive: Bool { action.kind == "delete" }
    private var node: String { session.nodeName(of: action.node) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(action.connector).\(action.tool)").font(.headline.monospaced())
                            Text(Approval.classLine(action.kind)).font(.subheadline).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: Approval.symbol(action.kind)).foregroundStyle(Color.siege)
                    }
                    if let why = action.why, !why.isEmpty { Text(why) }
                }
                if !action.args.isEmpty {
                    Section("What it sends") {
                        ForEach(action.args.keys.sorted(), id: \.self) { key in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(key).font(.caption.monospaced()).foregroundStyle(.secondary)
                                Text(action.args[key]?.text ?? "").font(.body.monospaced()).textSelection(.enabled)
                            }
                        }
                    }
                }
                Section {
                    LabeledContent("Where it goes") { Text(action.target).font(.footnote.monospaced()).multilineTextAlignment(.trailing) }
                    LabeledContent("Asked by", value: Approval.askedBy(action.by))
                    LabeledContent("Sent from", value: node)
                    LabeledContent("Expires") { Text(Date(timeIntervalSince1970: action.expires / 1000), style: .relative) }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
                if !session.can("fleet:admin") {
                    Section { Text("This device can't answer approvals (it has no fleet:admin scope).").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(destructive ? "Delete?" : "Send?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                if session.can("fleet:admin") {
                    HStack(spacing: 12) {
                        Button(role: .destructive) {
                            Task { await decide(false) }
                        } label: {
                            Text("Decline").frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.glass)
                        Button {
                            typed = ""
                            confirming = true
                        } label: {
                            Text(destructive ? "Approve delete…" : "Approve…").fontWeight(.semibold).foregroundStyle(Color.onAccent).frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.glassProminent)
                    }
                    .disabled(busy)
                    .padding()
                }
            }
            .alert(destructive ? "Approve this delete?" : "Approve and send?", isPresented: $confirming) {
                if destructive {
                    TextField(Approval.deleteName(connector: action.connector, tool: action.tool, target: action.target, args: action.args), text: $typed)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Button(destructive ? "Approve delete" : "Approve and send", role: destructive ? .destructive : nil) {
                    Task { await decide(true) }
                }
                .disabled(destructive && typed != Approval.deleteName(connector: action.connector, tool: action.tool, target: action.target, args: action.args))
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(destructive
                    ? "\(node) deletes \(action.target) once, as soon as you approve. It can't be brought back. Type its name to approve."
                    : "\(node) sends it to \(action.target) once, as soon as you approve. It can't be called back, and if it fails it isn't retried.")
            }
        }
    }

    private func decide(_ approve: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await session.decide(action, approve: approve)
            dismiss()
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// A key Galahad asked for: what for, and a secure field that seals it into the vault from here.
struct KeyRequestRow: View {
    let session: Session
    let request: SecretRequestView
    @State private var value = ""
    @State private var sealing = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text("Galahad asks for \(Text(request.name).font(.body.monospaced()).bold())")
            } icon: {
                Image(systemName: "key.fill").foregroundStyle(Color.siege)
            }
            Text(request.purpose).font(.subheadline)
            if let asked = hlcDate(request.requestedAt) {
                Text("Asked \(Text(asked, style: .relative)) ago").font(.caption).foregroundStyle(.secondary)
            }
            if session.can("vault:write") {
                HStack(spacing: 10) {
                    SecureField("Paste the key", text: $value)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.password)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(.fill.tertiary, in: .rect(cornerRadius: 12, style: .continuous))
                        .submitLabel(.done)
                        .onSubmit(seal)
                        .accessibilityIdentifier("key-\(request.name)")
                    Button(action: seal) {
                        if sealing { ProgressView().tint(Color.onAccent) } else { Text("Seal").fontWeight(.semibold).foregroundStyle(Color.onAccent) }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(value.isEmpty || sealing)
                }
            } else {
                Text("This device can't fill key requests (it has no vault:write scope).").font(.footnote).foregroundStyle(.secondary)
            }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
            }
        }
        .padding(.vertical, 4)
    }

    private func seal() {
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // The field is cleared before anything is sent: the key is never shown back.
        value = ""
        guard !key.isEmpty, !sealing else { return }
        sealing = true
        problem = nil
        Task {
            defer { sealing = false }
            do {
                try await session.seal(request, value: key)
            } catch {
                problem = "\(error.localizedDescription). Paste it again."
            }
        }
    }
}

/// A device asking to join: its name and the code it shows. Let it in only if the codes match.
struct JoinRequestRow: View {
    let session: Session
    let pairing: PairingView
    @State private var confirming = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(pairing.name).font(.headline)
                    Text(pairing.kind == "node" ? "A machine" : "A phone or browser").font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: pairing.kind == "node" ? "server.rack" : "iphone").foregroundStyle(Color.siege)
            }
            Text(pairing.sas).font(.system(.title, design: .monospaced).weight(.semibold))
            if pairing.conflict {
                Label("Two devices used this invite: it may have been intercepted. Nothing on it can be approved.", systemImage: "exclamationmark.octagon.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.siege)
            } else if session.can("fleet:admin") {
                HStack(spacing: 12) {
                    Button("Decline", role: .destructive) { Task { await answer(false) } }
                        .buttonStyle(.glass)
                    Button {
                        confirming = true
                    } label: {
                        Text("Let it in…").fontWeight(.semibold).foregroundStyle(Color.onAccent)
                    }
                    .buttonStyle(.glassProminent)
                }
            }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
            }
        }
        .padding(.vertical, 4)
        .alert("Let \(pairing.name) in?", isPresented: $confirming) {
            Button("Let it in") { Task { await answer(true) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Only if its screen shows \(pairing.sas). A different code means someone else holds the invite.")
        }
    }

    private func answer(_ approve: Bool) async {
        do {
            try await session.answer(pairing, approve: approve)
        } catch {
            problem = error.localizedDescription
        }
    }
}
