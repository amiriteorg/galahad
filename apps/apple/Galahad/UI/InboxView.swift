import SwiftUI

/// Everything that needs you, in one place (the PWA's Inbox): devices asking to join, calls Galahad's oath made him ask
/// your leave for, and keys he asked for. Nothing here happens without your say.
struct InboxView: View {
    let session: Session
    @State private var open: ActionView?

    var body: some View {
        GroupedList {
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
            if !session.facts.isEmpty {
                Section {
                    ForEach(session.facts) { fact in
                        FactRow(session: session, fact: fact)
                    }
                } header: {
                    Text("Facts he noticed about you")
                } footer: {
                    Text("Each goes with every answer of his once you keep it, in your words if you like. Until then it is only his note.")
                }
            }
        }
        .overlay {
            if !session.inboxLoaded {
                ProgressView()
            } else if session.inboxCount == 0 {
                ContentUnavailableView("Nothing needs you", systemImage: "checkmark.circle", description: Text("Approvals, keys Galahad asks for, facts he noticed about you and devices asking to join wait here."))
            }
        }
        .navigationTitle("Inbox")
        .refreshable { await session.refresh() }
        .sheet(item: $open) { action in
            ApprovalSheet(session: session, action: action)
        }
    }
}

/// A row of the Inbox: what it is about, in Galahad's red, in a column of its own, and everything else beside it, so
/// every row's words start at one edge whatever its icon.
struct InboxRow<Content: View>: View {
    let symbol: String
    /// It opens: a chevron at its end, as a row that leads somewhere has.
    var opens = false
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
            Image(systemName: symbol)
                .foregroundStyle(Color.siege)
                .frame(width: Metrics.iconColumn)
            VStack(alignment: .leading, spacing: Space.s3) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
            if opens {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, Space.s1)
    }
}

/// The buttons a row of the Inbox answers with: side by side, or one above the other when the words are too big for that.
struct InboxButtons<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Space.s3) { content }
            VStack(alignment: .leading, spacing: Space.s2) { content }
        }
    }
}

/// An approval in a line: what it calls, why, who asked, and until when.
struct ApprovalRow: View {
    let action: ActionView

    var body: some View {
        InboxRow(symbol: Approval.symbol(action.kind), opens: true) {
            VStack(alignment: .leading, spacing: Space.s1) {
                Text("\(action.connector).\(action.tool)").font(.headline.monospaced())
                if let why = action.why, !why.isEmpty { Text(why).font(.subheadline) }
                // Its time left counts down: in figures of one width, so the line doesn't shift as it does.
                Text("Asked by \(Approval.askedBy(action.by)) · expires in \(Text(Date(timeIntervalSince1970: action.expires / 1000), style: .relative))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
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
            GroupedList {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: Space.s1) {
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
                            VStack(alignment: .leading, spacing: Space.s1) {
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
                    LabeledContent("Expires in") { Text(Date(timeIntervalSince1970: action.expires / 1000), style: .relative).monospacedDigit() }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
                if !session.can("fleet:admin") {
                    Section { Text("This device can't answer approvals (it has no fleet:admin scope).").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(destructive ? "Delete?" : "Send?")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                if session.can("fleet:admin") {
                    HStack(spacing: Space.s3) {
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
                            Text(destructive ? "Approve delete…" : "Approve…").fontWeight(.semibold).foregroundStyle(Prominent.label()).frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.glassProminent)
                    }
                    .disabled(busy)
                    .padding(Metrics.margin)
                }
            }
            .alert(destructive ? "Approve this delete?" : "Approve and send?", isPresented: $confirming) {
                if destructive {
                    TextField(Approval.deleteName(connector: action.connector, tool: action.tool, target: action.target, args: action.args), text: $typed)
                        .capitals(.never)
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
        .sheetSize(width: 560, height: 600)
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
        InboxRow(symbol: "key.fill") {
            VStack(alignment: .leading, spacing: Space.s1) {
                Text("Galahad asks for \(Text(request.name).font(.body.monospaced()).bold())")
                Text(request.purpose).font(.subheadline)
                if let asked = hlcDate(request.requestedAt) {
                    Text("Asked \(Text(asked, style: .relative)) ago").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            if session.can("vault:write") {
                HStack(spacing: Space.s2) {
                    // (No password content type: an API key is no password of yours for AutoFill to keep. iOS still
                    // offers its Passwords bar on any secure field.)
                    FormField("Paste the key", text: $value, secure: true)
                        .capitals(.never)
                        .autocorrectionDisabled()
                        .quietField()
                        .submitLabel(.done)
                        .onSubmit(seal)
                        .accessibilityIdentifier("key-\(request.name)")
                    Button(action: seal) {
                        Group {
                            if sealing { ProgressView().tint(Color.onAccent) } else { Text("Seal").fontWeight(.semibold).foregroundStyle(Prominent.label(dimmed: value.isEmpty)) }
                        }
                        .frame(maxHeight: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(value.isEmpty || sealing)
                }
                .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("This device can't fill key requests (it has no vault:write scope).").font(.footnote).foregroundStyle(.secondary)
            }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
            }
        }
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

/// A fact about you he proposed: keep it as he put it, or in your words, or drop it.
struct FactRow: View {
    let session: Session
    let fact: Fact
    @State private var rewording = false
    @State private var words = ""
    @State private var problem: String?

    var body: some View {
        InboxRow(symbol: "person.text.rectangle") {
            Text(fact.text)
            if session.can("mind:write") {
                InboxButtons {
                    Button {
                        Task { await act { try await session.keep(fact) } }
                    } label: {
                        Text("Keep").fontWeight(.semibold).foregroundStyle(Prominent.label())
                    }
                    .buttonStyle(.glassProminent)
                    Button("In my words") {
                        words = fact.text
                        rewording = true
                    }
                    .buttonStyle(.glass)
                    Button("Drop", role: .destructive) { Task { await act { try await session.drop(fact) } } }
                        .buttonStyle(.glass)
                }
            }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
            }
        }
        .alert("In your words", isPresented: $rewording) {
            TextField("About you", text: $words)
            Button("Keep") {
                let said = words.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !said.isEmpty else { return }
                Task { await act { try await session.keep(fact, text: said) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It goes with every answer of his.")
        }
    }

    private func act(_ work: () async throws -> Void) async {
        do {
            try await work()
            problem = nil
        } catch {
            problem = error.localizedDescription
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
        InboxRow(symbol: pairing.kind == "node" ? "server.rack" : "iphone") {
            VStack(alignment: .leading, spacing: Space.line) {
                Text(pairing.name).font(.headline)
                Text(pairing.kind == "node" ? "A machine" : "A phone or browser").font(.caption).foregroundStyle(.secondary)
            }
            Text(pairing.sas).font(.system(.title, design: .monospaced).weight(.semibold))
            if pairing.conflict {
                Label("Two devices used this invite: it may have been intercepted. Nothing on it can be approved.", systemImage: "exclamationmark.octagon.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.siege)
            } else if session.can("fleet:admin") {
                InboxButtons {
                    Button("Decline", role: .destructive) { Task { await answer(false) } }
                        .buttonStyle(.glass)
                    Button {
                        confirming = true
                    } label: {
                        Text("Let it in…").fontWeight(.semibold).foregroundStyle(Prominent.label())
                    }
                    .buttonStyle(.glassProminent)
                }
            }
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
            }
        }
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
