import SwiftUI

/// A knight, new or changed (the PWA's knight form): its orb's colour, its name and handle, its job, its repository, the
/// harness and model role it works with, and its day's allowance. The node checks it all again when it is saved.
struct KnightEditor: View {
    let session: Session
    var existing: Teammate?
    /// Called with the knight as the node saved it.
    var saved: (Teammate) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var handle: String
    /// A handle you typed yourself stops following the name.
    @State private var handleTyped: Bool
    /// The colour you chose for its orb (one of the 24, or one it was given elsewhere); nil: the one its handle gives it.
    @State private var chosenColor: String?
    /// Whether its colour was chosen here: untouched, what is saved stays as it is (the PWA's avatarEditor).
    @State private var colorTouched = false
    @State private var instructions: String
    @State private var repository: String
    @State private var harness: String
    /// The command that starts its ACP agent in its VM (harness `acp`).
    @State private var acp: String
    @State private var role: String
    @State private var dailyTurns: Int
    @State private var enabled: Bool
    /// It leads the Roundtable (it is your primary knight), as the node is told when it is saved.
    @State private var leads: Bool
    @State private var roles: [String: Knights.RoleInfo]?
    /// Its own models, in the order they are tried; the toggles offered, in an order kept while you edit (nil: none offered).
    @State private var own: [String]
    @State private var offered: [Knights.ModelChoice]?
    /// Sensitive mode: these models alone, for every call of its work (core's heldModels).
    @State private var sensitive: Bool
    /// Keys of yours it may use but never see (PLAN #17); the secrets it may be given, once read (nil: not read).
    @State private var keys: [Teammate.KeyGrant]
    @State private var givable: [SecretView]?
    @State private var working = false
    @State private var problem: String?

    init(session: Session, existing: Teammate? = nil, saved: @escaping (Teammate) -> Void = { _ in }) {
        self.session = session
        self.existing = existing
        self.saved = saved
        _name = State(initialValue: existing?.name ?? "")
        _handle = State(initialValue: existing?.id ?? "")
        _handleTyped = State(initialValue: existing != nil)
        _chosenColor = State(initialValue: KnightOrb.chosenColor(existing?.avatar))
        _instructions = State(initialValue: existing?.instructions ?? "")
        _repository = State(initialValue: existing?.repository ?? "")
        _harness = State(initialValue: existing?.harness ?? "native")
        _acp = State(initialValue: existing?.acp ?? "")
        _role = State(initialValue: existing?.role ?? "engineer")
        _own = State(initialValue: existing?.models ?? [])
        _sensitive = State(initialValue: existing?.sensitive ?? false)
        _keys = State(initialValue: existing?.keys ?? [])
        _dailyTurns = State(initialValue: existing?.dailyTurns ?? 40)
        _enabled = State(initialValue: existing?.enabled ?? true)
        _leads = State(initialValue: existing.map { session.primary == $0.id } ?? false)
    }

    private var taken: [String] { (session.team?.teammates.map(\.id) ?? []) + (session.team?.removed?.map(\.id) ?? []) }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// What stops it being saved, in words; nil: nothing.
    private var invalid: String? {
        if trimmedName.isEmpty { return "Give it a name." }
        if !Knights.isHandle(handle) { return "A handle is a lowercase letter, then at most 31 lowercase letters, digits or hyphens." }
        if existing == nil, taken.contains(handle) { return "The handle \(handle) is taken. Choose another." }
        if sensitive, own.isEmpty { return "Sensitive mode holds a knight to models of its own: choose them first." }
        if harness == "acp", acp.trimmingCharacters(in: .whitespaces).isEmpty { return "Name the command that starts its ACP agent, e.g. goose acp." }
        return nil
    }

    /// Whose words its job is, when they aren't yours.
    private var author: String? {
        guard let by = existing?.instructionsBy, by != "owner" else { return nil }
        return by == "galahad" ? "Galahad" : session.teammate(by)?.name ?? by
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    OrbColorPicker(handle: handle, chosen: chosenColor) { color in
                        chosenColor = color
                        colorTouched = true
                    }
                    .listRowBackground(Color.clear)
                } header: {
                    Text("Colour")
                }

                Section {
                    FormField("e.g. Ada", text: $name)
                        .capitals(.words)
                        .onChange(of: name) { _, new in if !handleTyped { handle = Knights.handle(name: new, taken: taken) } }
                        .accessibilityIdentifier("knight-name")
                    if existing == nil {
                        FormField("handle", text: Binding(get: { handle }, set: { handle = $0; handleTyped = true }))
                            .font(.body.monospaced())
                            .capitals(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("knight-handle")
                    } else {
                        LabeledContent("Handle") { Text(handle).font(.body.monospaced()) }
                    }
                } header: {
                    Text("Name")
                } footer: {
                    Text("The handle addresses this knight, and stays the same when it is renamed.")
                }

                Section {
                    if let author, let existing {
                        Label("\(author) wrote this job when making \(existing.name), and it is told to \(existing.name) as \(author)'s brief. Change its words here and they are yours.", systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    FormField("Their job, how they work, and when to ask you.", text: $instructions, axis: .vertical)
                        .lineLimit(5...14)
                        .accessibilityIdentifier("knight-job")
                } header: {
                    Text("Job and instructions")
                } footer: {
                    Text("No keys or passwords: those belong in Keys.")
                }

                Section {
                    FormField("https://github.com/owner/repository" as String, text: $repository)
                        .keyboard(.url)
                        .capitals(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                } header: {
                    Text("Repository (optional)")
                } footer: {
                    Text("An HTTPS GitHub repository. Each task gets its own worktree of it in the knight's VM.")
                }

                Section {
                    Picker("Harness", selection: $harness) {
                        ForEach(Knights.harnesses, id: \.id) { each in Text(each.name).tag(each.id) }
                    }
                    if harness == "acp" {
                        // Any agent that speaks the Agent Client Protocol: what starts it in its ACP mode, in the VM.
                        FormField("Its ACP agent's command, e.g. goose acp", text: $acp)
                            .font(.body.monospaced())
                            .capitals(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("knight-acp")
                    }
                    Picker("Model role", selection: $role) {
                        ForEach(Knights.roles(roster: roles ?? [:], current: existing?.role), id: \.self) { each in
                            Text(roles?[each]?.models.isEmpty == true ? "\(each) · no model yet" : each).tag(each)
                        }
                    }
                } header: {
                    Text("How it works")
                } footer: {
                    // (A device that may not read the roster is told only where the role's models come from.)
                    Text("Choosing a harness doesn't install it or sign it in: that is done in the knight's VM.\(harness == "acp" ? " An ACP agent runs as you set it up there, with the role's model offered through the gateway as OPENAI_BASE_URL." : "") \(roles.map { Knights.roleLine(role: role, spec: $0[role]) + "." } ?? "The role picks its models from your Models settings.")")
                }

                if let offered, !offered.isEmpty {
                    Section {
                        ForEach(offered) { choice in
                            Toggle(isOn: Binding(get: { own.contains(choice.ref) }, set: { own = Knights.toggle(own, choice.ref, on: $0) })) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(choice.ref).font(.callout.monospaced())
                                    Text(choice.on.isEmpty ? "Through its provider" : "Runs on \(choice.on.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        Toggle("Sensitive mode: only these models, for everything it does", isOn: $sensitive)
                    } header: {
                        Text("Models")
                    } footer: {
                        Text("\(Knights.modelsLine(own: own, role: role, spec: roles?[role], sensitive: sensitive)). A local model runs on the node that serves it, for a knight on Galahad's own harness: a vendor's coding tool can't use one.")
                    }
                }

                if let givable, !givable.isEmpty || !keys.isEmpty {
                    Section {
                        ForEach(givable) { secret in
                            let given = keys.first { $0.secret == secret.name }
                            VStack(alignment: .leading, spacing: Space.s1) {
                                Toggle(isOn: Binding(get: { given != nil }, set: { on in
                                    keys.removeAll { $0.secret == secret.name }
                                    if on { keys.append(.init(secret: secret.name, header: "authorization", write: false)) }
                                })) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(secret.name).font(.callout.monospaced())
                                        Text(secret.origin ?? "").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                if let given {
                                    Picker("Its header", selection: Binding(get: { given.header }, set: { header in update(secret.name) { $0.header = header } })) {
                                        ForEach(Array(Set(["authorization", "x-api-key", "api-key", given.header])).sorted(), id: \.self) { header in
                                            Text(header == "authorization" ? "Authorization: Bearer" : header).tag(header)
                                        }
                                    }
                                    Toggle("Writes too", isOn: Binding(get: { given.write }, set: { write in update(secret.name) { $0.write = write } }))
                                }
                            }
                        }
                    } header: {
                        Text("Keys it may use")
                    } footer: {
                        Text("Its scripts call $GALAHAD_KEYS/<name>/… with $GALAHAD_TOKEN where the key would go: the gateway puts the key in, at its own address alone, and the key never enters its VM. Reads only, unless Writes too. A secret of yours is offered once it is pinned to its API's https address; a model's or a connector's key never is.")
                    }
                }

                Section {
                    Stepper(value: $dailyTurns, in: 0...1000, step: 5) {
                        LabeledContent("A day") { Text("\(dailyTurns) turns and jobs").monospacedDigit() }
                    }
                    Toggle("At work", isOn: $enabled)
                } footer: {
                    Text("Replies and jobs a day, not a money limit. Zero holds new work; off pauses it.")
                }

                Section {
                    Toggle("Primary knight", isOn: $leads)
                } footer: {
                    Text("Your primary knight leads the Roundtable: it comes first, and what you say to a room it sits in without naming anyone is its to answer. Off, Galahad leads.")
                }

                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
            }
            .navigationTitle(existing.map { "Edit \($0.name)" } ?? "New knight")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save") { Task { await save() } }
                        .disabled(working || trimmedName.isEmpty)
                }
            }
            .task {
                roles = await session.roles()
                // (The order is kept while you edit: what you turn on goes last, and nothing moves under your finger.)
                if let choices = await session.knightModels() { offered = Knights.modelChoices(choices, own: own) }
                // (Yours alone to give: a secret pinned to an https address, nobody else's purpose.)
                struct Listed: Decodable { let secrets: [SecretView] }
                if let listed = try? await session.client.get("/api/secrets", as: Listed.self) {
                    givable = listed.secrets.filter { $0.provider == nil && ($0.origin ?? "").hasPrefix("https://") }.sorted { $0.name < $1.name }
                }
            }
        }
        .sheetSize(width: 600, height: 720)
    }

    /// One of its keys, changed in place.
    private func update(_ secret: String, _ change: (inout Teammate.KeyGrant) -> Void) {
        guard let at = keys.firstIndex(where: { $0.secret == secret }) else { return }
        change(&keys[at])
    }

    private func save() async {
        if let invalid { problem = invalid; return }
        working = true
        defer { working = false }
        let address = repository.trimmingCharacters(in: .whitespacesAndNewlines)
        var input = KnightInput(
            id: handle, name: trimmedName, instructions: instructions, repository: address.isEmpty ? nil : address,
            harness: harness, role: role, enabled: enabled, dailyTurns: dailyTurns,
            // Its colour, when you chose here: the one you chose, or its handle's again. Untouched, it is left as it is.
            avatar: colorTouched ? (chosenColor.map(KnightInput.OrbColor.chosen) ?? .handle) : nil
        )
        // Its own models, to a node that knows them: none is its role's again.
        input.models = own.isEmpty ? nil : own
        input.sendModels = offered != nil || !(existing?.models ?? []).isEmpty
        // (Sent when it is on, or was: to a node that doesn't know it, nothing is said of it.)
        if sensitive || existing?.sensitive == true { input.sensitive = sensitive }
        if harness == "acp" { input.acp = acp.trimmingCharacters(in: .whitespaces) }
        // Its keys, to a node that knows them: said when they could be chosen here, or it had some.
        if givable != nil || !(existing?.keys ?? []).isEmpty {
            input.keys = keys.isEmpty ? nil : keys
            input.sendKeys = true
        }
        let knight: Teammate
        do {
            knight = try await session.save(knight: input)
        } catch {
            problem = error.localizedDescription
            return
        }
        // Who leads is the Roundtable's, kept apart from the knight: told only when it changed.
        if leads != (session.primary == knight.id) {
            do {
                try await session.arrange(primary: leads ? knight.id : "galahad")
            } catch {
                problem = "\(knight.name) is saved, but who leads didn't change: \(error.localizedDescription)"
                return
            }
        }
        saved(knight)
        dismiss()
    }
}

/// A knight's colour as you choose it (the PWA's avatarEditor): its orb as it will be, the 24 colours to choose from, each
/// named, the one you chose ringed in the ink, and the one its handle gives it.
struct OrbColorPicker: View {
    /// Its handle: its orb's own sphere, and the colour it gives it until you choose one.
    let handle: String
    /// The colour you chose (one of the 24, or one it was given elsewhere); nil: its handle's.
    let chosen: String?
    /// A colour chosen, or (nil) its handle's again.
    let choose: (String?) -> Void

    private var id: String { handle.isEmpty ? "knight" : handle }

    /// What its orb's colour is, in words.
    private var note: String {
        guard chosen == nil else { return "The colour you chose." }
        let tint = KnightOrb.colors(id: id, profile: nil).tint
        return "Its handle gives it \(KnightOrb.tints.firstIndex(of: tint).map { KnightOrb.tintNames[$0] } ?? "this colour"): change its handle and its colour comes with it, until you choose one."
    }

    var body: some View {
        VStack(spacing: Space.s3) {
            HStack(spacing: Space.s4) {
                // Its orb as it will be: the colour you chose (as its saved avatar would say it), or its handle's.
                WorkerFace(id: id, profile: chosen.map { .object(["v": .number(2), "color": .string($0)]) }, size: 96, expression: "idle")
                VStack(alignment: .leading, spacing: Space.s2) {
                    Text(note).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Its handle's colour") { choose(nil) }
                        .buttonStyle(.borderless)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: Metrics.touch), spacing: Space.s1)], spacing: Space.s1) {
                ForEach(KnightOrb.tints.indices, id: \.self) { n in
                    let tint = KnightOrb.tints[n]
                    Button { choose(tint) } label: {
                        Circle()
                            .fill(Color(hex: tint))
                            .overlay(Circle().strokeBorder(.black.opacity(0.14), lineWidth: 1))
                            .frame(width: 30, height: 30)
                            .padding(Space.s1)
                            .overlay(Circle().strokeBorder(chosen == tint ? Color.ink : .clear, lineWidth: 2))
                            .frame(width: Metrics.touch, height: Metrics.touch)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(KnightOrb.tintNames[n])
                    .accessibilityAddTraits(chosen == tint ? .isSelected : [])
                    .help(KnightOrb.tintNames[n])
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// A room of several knights, new or changed (the PWA's room form): its name, who is in it, and how many replies one
/// thing you say may set off between them.
struct RoomEditor: View {
    let session: Session
    var existing: TeamRoom?
    var saved: (TeamRoom) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var members: Set<String>
    @State private var budget: Int
    @State private var working = false
    @State private var problem: String?

    init(session: Session, existing: TeamRoom? = nil, saved: @escaping (TeamRoom) -> Void = { _ in }) {
        self.session = session
        self.existing = existing
        self.saved = saved
        _name = State(initialValue: existing?.name ?? "")
        _members = State(initialValue: Set(existing?.members ?? []))
        _budget = State(initialValue: existing?.turnBudget ?? 8)
    }

    private var knights: [Teammate] { session.team?.teammates ?? [] }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    FormField("e.g. Product studio", text: $name).accessibilityIdentifier("room-name")
                }
                Section {
                    ForEach(knights) { knight in
                        Button {
                            if members.contains(knight.id) { members.remove(knight.id) } else { members.insert(knight.id) }
                        } label: {
                            HStack(spacing: 12) {
                                WorkerFace(id: knight.id, profile: knight.avatar, size: 36)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(knight.name).foregroundStyle(.primary)
                                    Text(knight.role).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: members.contains(knight.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(members.contains(knight.id) ? Color.ink : Color.secondary)
                            }
                        }
                        .accessibilityAddTraits(members.contains(knight.id) ? .isSelected : [])
                    }
                } header: {
                    Text("Knights")
                } footer: {
                    Text(knights.isEmpty ? "Seat a knight first: a room is where knights talk with you and each other." : "They share this conversation and work things out between them.")
                }
                Section {
                    Stepper(value: $budget, in: 1...64) {
                        LabeledContent("Replies") { Text("\(budget) per message of yours").monospacedDigit() }
                    }
                } footer: {
                    Text("Every reply counts, their handoffs to each other too; each new message from you starts again.")
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
            }
            .navigationTitle(existing == nil ? "New room" : "Room settings")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save") { Task { await save() } }
                        .disabled(working || trimmedName.isEmpty || members.isEmpty)
                }
            }
        }
        .sheetSize(width: 520, height: 600)
    }

    private func save() async {
        working = true
        defer { working = false }
        // In the Roundtable's order, so a room reads the same on every device.
        let ordered = knights.map(\.id).filter(members.contains) + members.filter { id in !knights.contains { $0.id == id } }.sorted()
        do {
            let room = try await session.save(room: RoomInput(id: existing?.id, name: trimmedName, members: ordered, direct: existing?.direct, turnBudget: budget))
            saved(room)
            dismiss()
        } catch {
            problem = error.localizedDescription
        }
    }
}
