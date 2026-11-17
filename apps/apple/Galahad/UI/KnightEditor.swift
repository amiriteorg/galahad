import SwiftUI

/// A knight, new or changed (the PWA's knight form): the drawing it wears, its name and handle, its job, its repository,
/// the harness and model role it works with, and its day's allowance. The node checks it all again when it is saved.
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
    /// The drawing you chose; nil: the one its name and handle give it.
    @State private var chosenLook: String?
    @State private var instructions: String
    @State private var repository: String
    @State private var harness: String
    @State private var role: String
    @State private var dailyTurns: Int
    @State private var enabled: Bool
    /// It leads the Roundtable (it is your primary knight), as the node is told when it is saved.
    @State private var leads: Bool
    @State private var roles: [String: Knights.RoleInfo]?
    /// Its own models, in the order they are tried; the toggles offered, in an order kept while you edit (nil: none offered).
    @State private var own: [String]
    @State private var offered: [Knights.ModelChoice]?
    @State private var working = false
    @State private var problem: String?

    init(session: Session, existing: Teammate? = nil, saved: @escaping (Teammate) -> Void = { _ in }) {
        self.session = session
        self.existing = existing
        self.saved = saved
        _name = State(initialValue: existing?.name ?? "")
        _handle = State(initialValue: existing?.id ?? "")
        _handleTyped = State(initialValue: existing != nil)
        _chosenLook = State(initialValue: existing.map { AvatarLook.of(id: $0.id, name: $0.name, profile: $0.avatar) })
        _instructions = State(initialValue: existing?.instructions ?? "")
        _repository = State(initialValue: existing?.repository ?? "")
        _harness = State(initialValue: existing?.harness ?? "native")
        _role = State(initialValue: existing?.role ?? "engineer")
        _own = State(initialValue: existing?.models ?? [])
        _dailyTurns = State(initialValue: existing?.dailyTurns ?? 40)
        _enabled = State(initialValue: existing?.enabled ?? true)
        _leads = State(initialValue: existing.map { session.primary == $0.id } ?? false)
    }

    private var taken: [String] { (session.team?.teammates.map(\.id) ?? []) + (session.team?.removed?.map(\.id) ?? []) }
    private var look: String { chosenLook ?? AvatarLook.of(id: handle, name: name, profile: nil) }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// What stops it being saved, in words; nil: nothing.
    private var invalid: String? {
        if trimmedName.isEmpty { return "Give it a name." }
        if !Knights.isHandle(handle) { return "A handle is a lowercase letter, then at most 31 lowercase letters, digits or hyphens." }
        if existing == nil, taken.contains(handle) { return "The handle \(handle) is taken. Choose another." }
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
                    VStack(spacing: 14) {
                        Portrait(drawing: look, size: 120, expression: "idle", id: handle, temper: AvatarLook.temperament(id: handle, profile: existing?.avatar))
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(AvatarLook.looks, id: \.id) { each in
                                    Button { chosenLook = each.id } label: {
                                        VStack(spacing: 4) {
                                            Portrait(drawing: each.id, size: 56)
                                                .padding(4)
                                                .background(Circle().strokeBorder(each.id == look ? Color.ink : .clear, lineWidth: 2))
                                            Text(AvatarLook.title(each.id)).font(.caption2).foregroundStyle(each.id == look ? .primary : .secondary)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(AvatarLook.title(each.id))
                                    .accessibilityAddTraits(each.id == look ? .isSelected : [])
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                } header: {
                    Text("Which knight")
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
                    Picker("Model role", selection: $role) {
                        ForEach(Knights.roles(roster: roles ?? [:], current: existing?.role), id: \.self) { each in
                            Text(roles?[each]?.models.isEmpty == true ? "\(each) · no model yet" : each).tag(each)
                        }
                    }
                } header: {
                    Text("How it works")
                } footer: {
                    // (A device that may not read the roster is told only where the role's models come from.)
                    Text("Choosing a harness doesn't install it or sign it in: that is done in the knight's VM. \(roles.map { Knights.roleLine(role: role, spec: $0[role]) + "." } ?? "The role picks its models from your Models settings.")")
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
                    } header: {
                        Text("Models")
                    } footer: {
                        Text("\(Knights.modelsLine(own: own, role: role, spec: roles?[role])). A local model runs on the node that serves it, for a knight on Galahad's own harness: a vendor's coding tool can't use one.")
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
            }
        }
        .sheetSize(width: 600, height: 720)
    }

    private func save() async {
        if let invalid { problem = invalid; return }
        working = true
        defer { working = false }
        let address = repository.trimmingCharacters(in: .whitespacesAndNewlines)
        var input = KnightInput(
            id: handle, name: trimmedName, instructions: instructions, repository: address.isEmpty ? nil : address,
            harness: harness, role: role, enabled: enabled, dailyTurns: dailyTurns,
            avatar: AvatarLook.profile(look: look, temperament: AvatarLook.temperament(id: handle, profile: existing?.avatar))
        )
        // Its own models, to a node that knows them: none is its role's again.
        input.models = own.isEmpty ? nil : own
        input.sendModels = offered != nil || !(existing?.models ?? []).isEmpty
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
                                Portrait(drawing: AvatarLook.of(id: knight.id, name: knight.name, profile: knight.avatar), size: 36)
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
