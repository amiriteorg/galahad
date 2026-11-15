import SwiftUI

/// A knight: its drawing, its job, its day, and its tasks as they stand, newest first.
struct KnightView: View {
    let session: Session
    let id: String

    private var knight: Teammate? { session.teammate(id) }
    private var row: RosterRow? { session.rows.first { $0.id == id } }
    private var tasks: [TeamTask] { (session.team?.tasks ?? []).filter { $0.assignee == id }.sorted { $0.updatedAt > $1.updatedAt } }

    var body: some View {
        List {
            if let knight {
                Section {
                    HStack(spacing: 16) {
                        Portrait(drawing: AvatarLook.of(id: knight.id, name: knight.name, profile: knight.avatar), size: 96)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(knight.name).font(.title2.bold())
                            Text(knight.role.capitalized).font(.subheadline).foregroundStyle(.secondary)
                            if let row {
                                Text(row.line).font(.subheadline).foregroundStyle(row.needs ? Color.siege : .primary)
                            }
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
                    LabeledContent("Harness", value: Self.harness[knight.harness] ?? knight.harness)
                    if let repository = knight.repository { LabeledContent("Repository") { Text(repository).font(.footnote.monospaced()) } }
                }
                if !tasks.isEmpty {
                    Section("Tasks") {
                        ForEach(tasks, id: \.id) { task in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(task.title).font(.headline)
                                Label(Self.status(task), systemImage: Self.symbol(task))
                                    .font(.subheadline)
                                    .foregroundStyle(task.status == "failed" || task.status == "interrupted" ? Color.siege : .secondary)
                                let progress = Roster.firstLine(task.progress)
                                if task.status == "running", !progress.isEmpty { Text(progress).font(.caption.monospaced()).foregroundStyle(.secondary) }
                                if let error = task.error, !error.isEmpty, task.status == "failed" { Text(Roster.firstLine(error)).font(.caption).foregroundStyle(.secondary) }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } else {
                ContentUnavailableView("Not at the table", systemImage: "person.slash", description: Text("This knight isn't on the Roundtable any more."))
            }
        }
        .navigationTitle(knight?.name ?? "Knight")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await session.refresh() }
    }

    /// A knight's coding harness, as it is named to you (the PWA's HARNESS).
    static let harness = ["native": "Galahad", "opencode": "OpenCode", "hermes": "Hermes Agent", "claude": "Claude Code", "codex": "Codex"]

    static func status(_ task: TeamTask) -> String {
        switch task.status {
        case "running": "At work"
        case "queued": "Waiting its turn"
        case "done": task.verified ? "Done and verified" : "Done"
        case "failed": "Failed"
        case "stopped": "Stopped"
        case "interrupted": "Interrupted: review it before resuming"
        default: task.status
        }
    }

    static func symbol(_ task: TeamTask) -> String {
        switch task.status {
        case "running": "hammer"
        case "queued": "clock"
        case "done": task.verified ? "checkmark.seal" : "checkmark"
        case "failed", "interrupted": "exclamationmark.triangle"
        default: "stop.circle"
        }
    }
}
