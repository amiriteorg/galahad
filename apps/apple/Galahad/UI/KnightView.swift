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
    @FocusState private var composing: Bool

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
            VStack(alignment: .leading, spacing: 14) {
                if knight == nil {
                    ContentUnavailableView("Not at the table", systemImage: "person.slash", description: Text("This knight isn't on the Roundtable any more."))
                } else if room.view == nil, room.problem == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                } else if items.isEmpty, room.view != nil {
                    welcome
                }
                ForEach(items) { item in
                    switch item {
                    case .message(let message):
                        TeamBubble(message: message, speaker: Timeline.speaker(message, teammates: session.team?.teammates ?? []), look: message.speaker == "galahad" ? "galahad" : look)
                    case .task(let task):
                        TaskCardView(task: task) { action in act(action, on: task) }
                    }
                }
                if room.writing {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text("\(name) is writing…")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 44)
                }
                if let problem = room.problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if knight != nil {
                KnightComposer(room: room, name: name, client: session.client, composing: $composing)
            }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button { about = true } label: {
                    VStack(spacing: 1) {
                        Text(name).font(.headline).foregroundStyle(.primary)
                        if let row {
                            Text(row.line).font(.caption).foregroundStyle(row.needs ? Color.siege : .secondary).lineLimit(1)
                        }
                    }
                    // Between the back button and the toolbar's own: a long line ends in an ellipsis, not behind them.
                    .frame(maxWidth: 240)
                }
                .accessibilityHint("What \(name) is and how its day stands")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { giving = true } label: { Label("Give a task", systemImage: "hammer") }
                    .disabled(room.view == nil || knight == nil)
            }
        }
        .sheet(isPresented: $giving) {
            GiveTaskSheet(name: name) { title, goal, gates in
                try await room.give(title: title, goal: goal, gates: gates, with: session.client)
            }
        }
        .sheet(isPresented: $about) {
            if let knight { KnightAbout(knight: knight, row: row, look: look) }
        }
        .confirmationDialog("Stop this task?", isPresented: .init(get: { stopping != nil }, set: { if !$0 { stopping = nil } }), titleVisibility: .visible, presenting: stopping) { task in
            Button("Stop it", role: .destructive) { Task { await room.control(task, "stop", with: session.client) } }
        } message: { task in
            Text("“\(task.title)” stops where it is. What it changed so far stays in \(name)'s workspace.")
        }
        // Asked again while you're here: its replies and its work move on as it goes.
        .task(id: row?.room) {
            while !Task.isCancelled {
                await room.load(room: row?.room, with: session.client)
                try? await Task.sleep(for: .seconds(room.writing ? 2 : 4))
            }
        }
    }

    private var welcome: some View {
        VStack(spacing: 12) {
            Portrait(drawing: look, size: 120)
            Text(name).font(.title2.bold())
            Text("Say something to \(name), or give it a task: it works in its own workspace, and its commands and an independent review say whether the work is done.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
        .padding(.horizontal, 24)
    }

    private func act(_ action: TaskCard.Action, on task: TeamTask) {
        switch action {
        case .stop: stopping = task
        case .resume: Task { await room.control(task, "resume", with: session.client) }
        case .again: Task { await room.giveAgain(task, with: session.client) }
        }
    }

    /// A knight's coding harness, as it is named to you (the PWA's HARNESS).
    static let harness = ["native": "Galahad", "opencode": "OpenCode", "hermes": "Hermes Agent", "claude": "Claude Code", "codex": "Codex"]
}

/// A word in a knight's room: yours on the right in the ink, the knight's and Galahad's on the left beside their
/// drawings, the Roundtable's own notes in the middle.
private struct TeamBubble: View {
    let message: TeamMessage
    let speaker: String
    let look: String

    var body: some View {
        switch message.speaker {
        case "owner":
            HStack {
                Spacer(minLength: 56)
                Text(message.text)
                    .foregroundStyle(Color.onAccent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.ink, in: .rect(cornerRadius: 20, style: .continuous))
                    .textSelection(.enabled)
            }
        case "system":
            Text(message.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        default:
            HStack(alignment: .top, spacing: 10) {
                Portrait(drawing: look, size: 34)
                VStack(alignment: .leading, spacing: 3) {
                    if message.speaker == "galahad" { Text(speaker).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                    MarkdownView(message.text)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.fill.tertiary, in: .rect(cornerRadius: 20, style: .continuous))
                        .textSelection(.enabled)
                }
                Spacer(minLength: 24)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(speaker): \(message.text)")
        }
    }
}

/// A task where it was given: what it is, where it stands, how it ended and why, what it kept, and what you can do.
struct TaskCardView: View {
    let task: TeamTask
    let act: (TaskCard.Action) -> Void

    private var badge: (text: String, tone: TaskCard.Tone) { TaskCard.badge(task) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: symbol).foregroundStyle(color(badge.tone))
                Text(task.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                HStack(spacing: 4) {
                    if task.status == "running" { ProgressView().controlSize(.mini).accessibilityHidden(true) }
                    Text(badge.text)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(color(badge.tone))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(color(badge.tone).opacity(0.12), in: .capsule)
            }
            if let given = TaskCard.given(task) { Text(given).font(.caption).foregroundStyle(.secondary) }
            if task.status == "running", !Roster.firstLine(task.progress).isEmpty {
                Text(Roster.firstLine(task.progress)).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(2)
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
            let actions = TaskCard.actions(task)
            if !actions.isEmpty {
                HStack(spacing: 8) {
                    ForEach(actions, id: \.rawValue) { action in
                        Button(action == .stop ? "Stop" : action == .resume ? "Resume" : "Give again") { act(action) }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(action == .stop ? Color.siege : .ink)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: .rect(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var symbol: String {
        switch task.status {
        case "running": "hammer"
        case "queued": "clock"
        case "done": task.verified ? "checkmark.seal.fill" : "checkmark.circle"
        case "failed", "interrupted": "exclamationmark.triangle.fill"
        default: "stop.circle"
        }
    }

    private func color(_ tone: TaskCard.Tone) -> Color {
        switch tone {
        case .ok: .green
        case .warn: .orange
        case .danger: .siege
        case .accent: .ink
        case .neutral: .secondary
        }
    }
}

/// The message box at the foot of a knight's page.
private struct KnightComposer: View {
    @Bindable var room: KnightRoom
    let name: String
    let client: NodeClient
    var composing: FocusState<Bool>.Binding

    var body: some View {
        let empty = room.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message \(name)", text: $room.draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused(composing)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22, style: .continuous))
                Button {
                    Task { await room.send(with: client) }
                } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(empty ? Color.secondary : Color.onAccent).frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(empty || room.sending || room.view == nil)
                .accessibilityLabel("Send to \(name)")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
}

/// Giving a knight a task: a concrete result, what it should do and what proves it done, and the commands that check it.
private struct GiveTaskSheet: View {
    let name: String
    let give: (String, String, [String]) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var goal = ""
    @State private var gates = ""
    @State private var working = false
    @State private var problem: String?

    private var ready: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") { TextField("A concrete result", text: $title) }
                Section("Goal") {
                    TextField("What should be built or investigated, and what proves it is complete?", text: $goal, axis: .vertical).lineLimit(4...12)
                }
                Section {
                    TextField("bun run check", text: $gates, axis: .vertical)
                        .lineLimit(2...8)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Done when these pass")
                } footer: {
                    Text("One shell command a line, up to 16. They run in \(name)'s workspace; they and an independent reviewer decide whether the work is verified.")
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
                }
            }
            .navigationTitle("Give \(name) a task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Give") { Task { await submit() } }.disabled(!ready || working)
                }
            }
        }
    }

    private func submit() async {
        switch KnightRoom.gates(from: gates) {
        case .failure(let error): problem = error.message
        case .success(let commands):
            working = true
            defer { working = false }
            do {
                try await give(title.trimmingCharacters(in: .whitespacesAndNewlines), goal.trimmingCharacters(in: .whitespacesAndNewlines), commands)
                dismiss()
            } catch {
                problem = error.localizedDescription
            }
        }
    }
}

/// What a knight is and how its day stands.
private struct KnightAbout: View {
    let knight: Teammate
    let row: RosterRow?
    let look: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        Portrait(drawing: look, size: 96)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(knight.name).font(.title2.bold())
                            Text(knight.role.capitalized).font(.subheadline).foregroundStyle(.secondary)
                            if let row { Text(row.line).font(.subheadline).foregroundStyle(row.needs ? Color.siege : .primary) }
                        }
                    }
                    .padding(.vertical, 4)
                }
                if !knight.instructions.isEmpty {
                    Section("Its job") { Text(knight.instructions) }
                }
                Section("Today") {
                    LabeledContent("State", value: knight.enabled ? "At the table" : "Paused")
                    LabeledContent("Turns", value: "\(knight.turnsToday) of \(knight.dailyTurns)")
                    LabeledContent("Harness", value: KnightView.harness[knight.harness] ?? knight.harness)
                    if let repository = knight.repository { LabeledContent("Repository") { Text(repository).font(.footnote.monospaced()) } }
                }
            }
            .navigationTitle(knight.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
