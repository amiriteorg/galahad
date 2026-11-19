import SwiftUI

/// A knight: one timeline of what you said to each other and the work you gave it, in the order it happened, with the
/// message box below and its tasks where they were given (the PWA's knight timeline). What it is and how its day stands
/// are a tap away.
struct KnightView: View {
    let session: Session
    let id: String
    @State private var room: KnightRoom
    @State private var giving = false
    @State private var about = false
    @State private var stopping: TeamTask?
    /// The verified work being shipped as a pull request (ShipPrompt asks its title).
    @State private var shipping: TeamTask?
    @FocusState private var composing: Bool
    @Environment(\.dismiss) private var leave
    @State private var watching = false
    @State private var inTerminal = false
    /// Its workspace as a sheet (an iPhone); beside the conversation where what holds it hosts a column for it.
    @State private var inWorkspace = false
    @Environment(\.workspaceColumn) private var workspaceColumn

    init(session: Session, id: String) {
        self.session = session
        self.id = id
        _room = State(initialValue: KnightRoom(knight: id))
    }

    private var knight: Teammate? { session.teammate(id) }
    private var row: RosterRow? { session.rows.first { $0.id == id } }
    private var look: String { AvatarLook.of(id: id, name: knight?.name ?? id, profile: knight?.avatar) }
    private var name: String { knight?.name ?? "Knight" }

    private var items: [Timeline.Item] {
        guard let view = room.view else { return [] }
        // Every task given to this knight, wherever: the room's own, and any the Roundtable's list holds.
        var tasks = view.tasks
        for task in session.team?.tasks ?? [] where !tasks.contains(where: { $0.id == task.id }) { tasks.append(task) }
        return Timeline.items(messages: view.messages, tasks: Timeline.tasks(room: (view.id, view.direct, view.members), all: tasks))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.margin) {
                if knight == nil {
                    ContentUnavailableView("Not at the table", systemImage: "person.slash", description: Text("This knight isn't on the Roundtable any more."))
                } else if room.view == nil, room.problem == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, Space.s10)
                } else if items.isEmpty, room.view != nil {
                    welcome
                }
                ForEach(items) { item in
                    switch item {
                    case .message(let message):
                        TeamBubble(message: message, speaker: Timeline.speaker(message, teammates: session.team?.teammates ?? []), look: message.speaker == "galahad" ? "galahad" : look, client: session.client) { text in
                            room.quote(text, by: Timeline.speaker(message, teammates: session.team?.teammates ?? []))
                            composing = true
                        }
                    case .task(let task):
                        TaskCardView(task: task, proposer: task.proposedBy.map { $0 == "galahad" ? "Galahad" : session.teammate($0)?.name ?? $0 }) { action in act(action, on: task) }
                    }
                }
                if room.writing {
                    WritingLine(words: "\(name) is writing…")
                }
                if let problem = room.problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
                }
            }
            .padding(.horizontal, Metrics.margin)
            .padding(.vertical, Space.s3)
            .readingWidth()
        }
        .keepingLatest()
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if knight != nil {
                RoomComposer(room: room, name: name, client: session.client, composing: $composing, seats: [Mentions.Seat(id: id, name: name), Mentions.Seat(id: "galahad", name: "Galahad")])
            }
        }
        .navigationTitle(name)
        .inlineTitle()
        .hidingTabBar()
        #if os(macOS)
        // On a Mac, the window's own title and its subtitle; what it is and how its day stands is a button beside them.
        .navigationSubtitle(row?.line ?? "")
        #endif
        .toolbar {
            #if os(macOS)
            ToolbarItem(placement: .barTrailing) {
                Button { about = true } label: { Label("About \(name)", systemImage: "info.circle") }
                    .disabled(knight == nil)
            }
            #else
            ToolbarItem(placement: .principal) {
                // Not a Button: the bar sizes a button by its whole line, which then runs under the bar's own buttons; a
                // plain title gets the room between them, and ends in an ellipsis there.
                TimelineTitle(title: name, line: row?.line, needs: row?.needs ?? false)
                    .contentShape(.rect)
                    .onTapGesture { about = true }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { about = true }
                    .accessibilityHint("What \(name) is and how its day stands")
            }
            #endif
            // Its VM, once it has one: its files and what its task changed, beside this; its screen to watch and take
            // over, and a terminal in it.
            if let knight, knight.workspace != nil, session.can("sandbox") {
                ToolbarItem(placement: .barTrailing) {
                    Button {
                        if let workspaceColumn { workspaceColumn.wrappedValue.toggle() } else { inWorkspace = true }
                    } label: {
                        Label("Workspace", systemImage: workspaceColumn?.wrappedValue == true ? "folder.fill" : "folder")
                    }
                    .accessibilityIdentifier("workspace")
                }
                ToolbarItem(placement: .barTrailing) {
                    Menu {
                        Button { watching = true } label: { Label("Its screen", systemImage: "display") }
                        Button { inTerminal = true } label: { Label("Its terminal", systemImage: "apple.terminal") }
                    } label: {
                        Label("Its VM", systemImage: "desktopcomputer")
                    }
                }
            }
            ToolbarItem(placement: .barTrailing) {
                Button { giving = true } label: { Label("Give a task", systemImage: "hammer") }
                    .disabled(room.view == nil || knight == nil)
            }
        }
        .sheet(isPresented: $giving) {
            GiveTaskSheet(name: name) { title, goal, gates, _, budget in
                try await room.give(title: title, goal: goal, gates: gates, budgetUsd: budget, with: session.client)
            }
        }
        .navigationDestination(isPresented: $watching) {
            if let knight { KnightScreenView(session: session, knight: VMSeat(knight)) }
        }
        .cover(isPresented: $inTerminal) {
            if let knight { KnightTerminalView(session: session, knight: VMSeat(knight)) }
        }
        .sheet(isPresented: $inWorkspace) { WorkspaceView(session: session, id: id, name: name) }
        .sheet(isPresented: $about) {
            KnightAbout(session: session, id: id, row: row, look: look) { leave() }
        }
        .confirmationDialog("Stop this task?", isPresented: .init(get: { stopping != nil }, set: { if !$0 { stopping = nil } }), titleVisibility: .visible, presenting: stopping) { task in
            Button("Stop it", role: .destructive) { Task { await room.control(task, "stop", with: session.client) } }
        } message: { task in
            Text("“\(task.title)” stops where it is. What it changed so far stays in \(name)'s workspace.")
        }
        .modifier(ShipPrompt(task: $shipping, room: room, client: session.client))
        // Asked again while you're here: its replies and its work move on as it goes.
        .task(id: row?.room) {
            while !Task.isCancelled {
                await room.load(room: row?.room, with: session.client)
                try? await Task.sleep(for: .seconds(room.writing ? 2 : 4))
            }
        }
        // On screen, what ended here is read (its replies to you, its tasks): no longer new, on any device.
        .task(id: row?.unread) {
            if row?.unread == true { await session.read(knight: id) }
        }
    }

    private var welcome: some View {
        TimelineWelcome(title: name, words: "Say something to \(name), or give it a task: it works in its own workspace, and its commands and an independent review say whether the work is done.") {
            Portrait(drawing: look, size: Metrics.welcomeFace, expression: row?.expression ?? "idle", id: id, temper: AvatarLook.temperament(id: id, profile: knight?.avatar))
        }
    }

    private func act(_ action: TaskCard.Action, on task: TeamTask) {
        switch action {
        case .approve: Task { await room.control(task, "approve", with: session.client) }
        case .decline: Task { await room.control(task, "stop", with: session.client) }
        case .stop: stopping = task
        case .resume: Task { await room.control(task, "resume", with: session.client) }
        case .again: Task { await room.giveAgain(task, with: session.client) }
        case .ship: shipping = task
        }
    }

    /// A knight's coding harness, as it is named to you (the PWA's HARNESS).
    static let harness = ["native": "Galahad", "opencode": "OpenCode", "hermes": "Hermes Agent", "claude": "Claude Code", "codex": "Codex"]
}

/// A word in a knight's room: yours on the right in the ink, the knight's and Galahad's on the left beside their
/// drawings, the Roundtable's own notes in the middle. `named`: in a room of several, every knight's name is said.
struct TeamBubble: View {
    let message: TeamMessage
    let speaker: String
    let look: String
    var named = false
    /// Where a picture you sent is read from, to show it (nil: shown only once it is known here).
    var client: NodeClient? = nil
    /// Quoting it in your next message (MessageMenu's Reply), with who said it.
    var reply: ((String) -> Void)? = nil

    var body: some View {
        switch message.speaker {
        case "owner":
            VStack(alignment: .trailing, spacing: Space.s2) {
                // What it carried, above its words (a message may be files alone).
                if let refs = message.attachments, !refs.isEmpty { AttachedView(refs: refs, client: client) }
                if !message.text.isEmpty {
                    HStack {
                        Spacer(minLength: Metrics.yoursInset)
                        Text(message.text)
                            .foregroundStyle(Color.onAccent)
                            .padding(Metrics.bubblePadding)
                            .background(Color.ink, in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
                            .messageMenu(message.text, reply: reply)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        case "system":
            Text(message.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        default:
            HStack(alignment: .top, spacing: Space.s2) {
                Portrait(drawing: look, size: Metrics.speakerFace)
                VStack(alignment: .leading, spacing: Space.s1) {
                    if named || message.speaker == "galahad" { Text(speaker).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                    MarkdownView(message.text)
                        .padding(Metrics.bubblePadding)
                        .background(.fill.tertiary, in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
                        .messageMenu(message.text, reply: reply)
                }
                Spacer(minLength: Space.s6)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(speaker): \(message.text)")
        }
    }
}

/// A task where it was given: what it is, where it stands, how it ended and why, what it kept, and what you can do. One
/// a knight proposed waits for you here, with Approve and Decline. Its badge says where it stands, so nothing else does,
/// and every line of it starts at one edge.
struct TaskCardView: View {
    let task: TeamTask
    /// The name of the knight that proposed it, when one did.
    var proposer: String? = nil
    let act: (TaskCard.Action) -> Void

    private var badge: (text: String, tone: TaskCard.Tone) { TaskCard.badge(task) }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
                Text(task.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Space.s1)
                StateBadge(text: badge.text, tone: badge.tone.rawValue, busy: task.status == "running")
            }
            if let proposed = TaskCard.proposed(task, proposer: proposer) { Text(proposed).font(.caption).foregroundStyle(.secondary) }
            if let given = TaskCard.given(task) { Text(given).font(.caption).foregroundStyle(.secondary) }
            if let stepped = TaskCard.stepped(task) { Text(stepped).font(.caption).foregroundStyle(.secondary) }
            if task.status == "proposed" {
                Text(task.goal).font(.callout).lineLimit(6).fixedSize(horizontal: false, vertical: true)
                if let gates = task.gates, !gates.isEmpty {
                    Label("Done when \(gates.joined(separator: " · ")) pass\(gates.count == 1 ? "es" : "")", systemImage: "checkmark.seal")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
            if task.status == "running" {
                // Two lines kept from the start, so the card doesn't grow as its latest line comes and lengthens.
                let latest = Roster.firstLine(task.progress)
                Text(latest.isEmpty ? " " : latest).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true)
            }
            if let end = TaskCard.end(task) {
                if let why = end.why {
                    Text(why).font(.caption).foregroundStyle(badge.tone == .danger || badge.tone == .warn ? Color.siege : .secondary).fixedSize(horizontal: false, vertical: true)
                }
                if let said = end.said {
                    Text(said).font(.caption).foregroundStyle(.secondary).lineLimit(4)
                }
            }
            if let kept = TaskCard.kept(task) {
                Label(kept, systemImage: "doc.badge.plus").font(.caption).foregroundStyle(.secondary)
            }
            if let shipped = TaskCard.shipped(task), let url = URL(string: shipped.url) {
                Link(destination: url) { Label(shipped.text, systemImage: "arrow.up.forward.square") }.font(.caption)
            }
            let actions = TaskCard.actions(task)
            if !actions.isEmpty {
                // One size for every card's buttons, big enough for a thumb.
                HStack(spacing: Space.s2) {
                    ForEach(actions, id: \.rawValue) { action in
                        if action == .approve || action == .ship {
                            Button(action == .ship ? "Ship it" : "Approve") { act(action) }
                                .buttonStyle(.borderedProminent)
                                .tint(.ink)
                        } else {
                            Button(Self.label[action] ?? action.rawValue) { act(action) }
                                .buttonStyle(.bordered)
                                .tint(action == .stop ? Color.siege : .ink)
                        }
                    }
                }
                .controlSize(.regular)
            }
        }
        .padding(Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private static let label: [TaskCard.Action: String] = [.decline: "Decline", .stop: "Stop", .resume: "Resume", .again: "Give again"]
}

/// Asks a pull request's title (the task's, to change) before a knight's verified work is shipped: the PWA's shipTask.
struct ShipPrompt: ViewModifier {
    @Binding var task: TeamTask?
    let room: KnightRoom
    let client: NodeClient
    @State private var title = ""

    func body(content: Content) -> some View {
        content
            .alert("Ship it as a pull request?", isPresented: .init(get: { task != nil }, set: { if !$0 { task = nil } }), presenting: task) { task in
                TextField("Pull request title", text: $title)
                Button("Open pull request") { Task { _ = await room.ship(task, title: title, with: client) } }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Cancel", role: .cancel) {}
            } message: { task in
                Text("\(task.changes.map { "\($0.files) file\($0.files == 1 ? "" : "s")" } ?? "Its changes"), on a new galahad/… branch of its repository, as it was verified. Its checks are followed after.")
            }
            .onChange(of: task?.id) { title = String(task?.title.prefix(120) ?? "") }
    }
}

/// The message box at the foot of a conversation: a knight's own, or a room's.
struct RoomComposer: View {
    @Bindable var room: KnightRoom
    /// Who it goes to, as the box and its button say: a knight's name, or the room's.
    let name: String
    let client: NodeClient
    var composing: FocusState<Bool>.Binding
    /// Who may be named here with @ (MentionChoices).
    var seats: [Mentions.Seat] = []

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            MentionChoices(draft: $room.draft, seats: seats)
            OutboxLines(outbox: room.outbox)
            field
        }
        .padding(.horizontal, Metrics.margin)
        .padding(.vertical, Space.s2)
        .readingWidth()
        .takingFiles(room.outbox, client: client, composing: composing)
    }

    private var field: some View {
        let empty = !room.sendable
        return GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: Space.s2) {
                AttachButton(outbox: room.outbox, client: client)
                TextField("Message \(name)", text: $room.draft, axis: .vertical)
                    .plainField()
                    .lineLimit(1...6)
                    .focused(composing)
                    .sendsOnReturn { if room.sendable { Task { await room.send(with: client) } } }
                    .padding(.horizontal, Space.s4)
                    // One line high, the field is 44 points: Apple's least for a thing to tap.
                    .padding(.vertical, 11)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22, style: .continuous))
                Button {
                    Task { await room.send(with: client) }
                } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(Prominent.label(dimmed: empty)).frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(empty)
                .accessibilityLabel("Send to \(name)")
            }
        }
    }
}

/// Giving a knight a task: a concrete result, what it should do and what proves it done, and the commands that check it.
/// In a room of several, `members` are those it may go to: you choose one.
struct GiveTaskSheet: View {
    let name: String
    var members: [(id: String, name: String)] = []
    let give: (String, String, [String], String?, Double?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var goal = ""
    @State private var gates = ""
    @State private var budget = ""
    @State private var assignee = ""
    @State private var working = false
    @State private var problem: String?

    private var ready: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (members.isEmpty || !assignee.isEmpty)
    }
    /// Whose workspace the commands run in.
    private var worker: String { members.first { $0.id == assignee }?.name ?? name }

    var body: some View {
        NavigationStack {
            Form {
                if !members.isEmpty {
                    Section("Who takes it") {
                        Picker("Knight", selection: $assignee) {
                            ForEach(members, id: \.id) { member in Text(member.name).tag(member.id) }
                        }
                    }
                }
                Section("Title") { FormField("A concrete result", text: $title) }
                Section("Goal") {
                    FormField("What should be built or investigated, and what proves it is complete?", text: $goal, axis: .vertical).lineLimit(4...12)
                }
                Section {
                    FormField("bun run check", text: $gates, axis: .vertical)
                        .lineLimit(2...8)
                        .font(.body.monospaced())
                        .capitals(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Done when these pass")
                } footer: {
                    Text("One shell command a line, up to 16. They run in \(worker)'s workspace; they and an independent reviewer decide whether the work is verified.")
                }
                Section {
                    FormField("0.50", text: $budget).keyboard(.decimal).monospacedDigit()
                } header: {
                    Text("Budget in US dollars (optional)")
                } footer: {
                    Text("What its model calls may spend, at your prices. It is told what it has spent, and stops with what it has when it is spent.")
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
            }
            .navigationTitle(members.isEmpty ? "Give \(name) a task" : "Give a task")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Give") { Task { await submit() } }.disabled(!ready || working)
                }
            }
            .onAppear { if assignee.isEmpty { assignee = members.first?.id ?? "" } }
        }
        .sheetSize(width: 560, height: 640)
    }

    private func submit() async {
        let money: Double?
        switch KnightRoom.budget(from: budget) {
        case .failure(let error): problem = error.message; return
        case .success(let usd): money = usd
        }
        switch KnightRoom.gates(from: gates) {
        case .failure(let error): problem = error.message
        case .success(let commands):
            working = true
            defer { working = false }
            do {
                try await give(title.trimmingCharacters(in: .whitespacesAndNewlines), goal.trimmingCharacters(in: .whitespacesAndNewlines), commands, members.isEmpty ? nil : assignee, money)
                dismiss()
            } catch {
                problem = error.localizedDescription
            }
        }
    }
}

/// What a knight is and how its day stands, and what you may change: its settings, whether it works, whether it stays.
private struct KnightAbout: View {
    let session: Session
    let id: String
    let row: RosterRow?
    let look: String
    /// It was taken off the Roundtable: its page closes too.
    let removed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var removing = false
    @State private var working = false
    @State private var problem: String?

    private var knight: Teammate? { session.teammate(id) }

    var body: some View {
        NavigationStack {
            GroupedList {
                if let knight {
                    Section {
                        HStack(spacing: Space.s4) {
                            Portrait(drawing: look, size: 96, expression: row?.expression ?? "idle", id: knight.id, temper: AvatarLook.temperament(id: knight.id, profile: knight.avatar))
                            VStack(alignment: .leading, spacing: Space.s1) {
                                Text(knight.name).font(.title2.bold())
                                Text(knight.models?.isEmpty == false ? Knights.worksOn(role: knight.role.capitalized, models: knight.models) : knight.role.capitalized).font(.subheadline).foregroundStyle(.secondary)
                                if let row { Text(row.line).font(.subheadline).foregroundStyle(row.needs ? Color.needs : .primary) }
                            }
                        }
                        .padding(.vertical, Space.s1)
                    }
                    if !knight.instructions.isEmpty {
                        Section("Its job") { Text(knight.instructions) }
                    }
                    Section("Today") {
                        LabeledContent("State", value: knight.enabled ? "At the table" : "Paused")
                        LabeledContent("Turns") { Text("\(knight.turnsToday) of \(knight.dailyTurns)").monospacedDigit() }
                        LabeledContent("Harness", value: KnightView.harness[knight.harness] ?? knight.harness)
                        LabeledContent("Its VM", value: knight.workspace != nil ? "Yes" : knight.workspaceNode != nil ? "Being made" : "None yet")
                        if let repository = knight.repository { LabeledContent("Repository") { Text(repository).font(.footnote.monospaced()) } }
                    }
                    if session.can("fleet:admin") {
                        Section {
                            Button { editing = true } label: { Label("Edit \(knight.name)", systemImage: "slider.horizontal.3") }
                            Button { Task { await setWorking(!knight.enabled) } } label: {
                                Label(knight.enabled ? "Pause \(knight.name)" : "Let \(knight.name) work again", systemImage: knight.enabled ? "pause.circle" : "play.circle")
                            }
                            .disabled(working)
                        } footer: {
                            Text(knight.enabled ? "Paused, it takes no new work, and what it is doing now stops where it is." : "It takes up what waited for it.")
                        }
                        Section {
                            Button("Remove \(knight.name) from the Roundtable", role: .destructive) { removing = true }
                        }
                    }
                    if let problem {
                        Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                    }
                } else {
                    ContentUnavailableView("Not at the table", systemImage: "person.slash", description: Text("This knight isn't on the Roundtable any more."))
                }
            }
            .navigationTitle(knight?.name ?? "Knight")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $editing) {
                if let knight { KnightEditor(session: session, existing: knight) }
            }
            .sheet(isPresented: $removing) {
                if let knight {
                    RemoveKnightSheet(session: session, knight: knight) {
                        dismiss()
                        removed()
                    }
                }
            }
        }
        .sheetSize(width: 560, height: 640)
    }

    private func setWorking(_ on: Bool) async {
        working = true
        defer { working = false }
        do {
            try await session.control(knight: id, on ? "resume" : "pause")
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// Taking a knight off the Roundtable, for good: what that does said first (lib/team.ts' removal plan), and its handle
/// typed to say you mean it.
private struct RemoveKnightSheet: View {
    let session: Session
    let knight: Teammate
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var working = false
    @State private var problem: String?

    private var plan: Knights.Removal {
        Knights.removal(id: knight.id, name: knight.name, workspace: knight.workspace != nil, workspaceNode: knight.workspaceNode != nil, maySandbox: session.can("sandbox"))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(plan.lines, id: \.self) { Text($0) }
                }
                if let blocked = plan.blocked {
                    Section { Label(blocked, systemImage: "lock.fill").foregroundStyle(Color.siege) }
                } else {
                    Section {
                        FormField(knight.id, text: $typed)
                            .font(.body.monospaced())
                            .capitals(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("remove-handle")
                    } header: {
                        Text("Type \(knight.id) to remove \(knight.name)")
                    }
                    Section {
                        Button(plan.destroyWorkspace ? "Remove and destroy its VM" : "Remove \(knight.name)", role: .destructive) { Task { await remove() } }
                            .disabled(typed != knight.id || working)
                    }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
            }
            .navigationTitle("Remove \(knight.name)?")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .sheetSize(width: 520, height: 480)
    }

    private func remove() async {
        working = true
        defer { working = false }
        do {
            try await session.remove(knight: knight.id, destroyWorkspace: plan.destroyWorkspace)
            dismiss()
            done()
        } catch {
            problem = error.localizedDescription
        }
    }
}
