import SwiftUI

/// Where a row of the Roundtable leads.
enum Route: Hashable {
    case galahad
    case knight(String)
    case room(String)
}

/// The Roundtable: Galahad first, then every knight, each with its drawing and one line of what it is doing, marked in
/// Galahad's red when only you can move it on (lib/roster.ts says what each line is).
struct RoundtableView: View {
    let session: Session
    /// On an iPad, the row whose page the detail column shows; on an iPhone a row is pushed instead.
    var selection: Binding<Route?>? = nil
    /// Opens a page: one just made, say (on an iPhone it is pushed; on an iPad it is shown beside).
    var open: (Route) -> Void = { _ in }
    @State private var query = ""
    @State private var giving = false
    @State private var seating = false
    @State private var gathering = false
    @Environment(\.colorScheme) private var scheme

    private var words: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var knights: [RosterRow] {
        let rows = session.rows
        guard !words.isEmpty else { return rows }
        return rows.filter { $0.name.localizedStandardContains(words) || $0.line.localizedStandardContains(words) }
    }

    private var rooms: [RoomRow] {
        let rows = session.roomRows
        guard !words.isEmpty else { return rows }
        return rows.filter { $0.name.localizedStandardContains(words) || $0.line.localizedStandardContains(words) }
    }

    var body: some View {
        List(selection: selection) {
            if let trouble = session.trouble {
                Section { TroubleRow(trouble: trouble) }
            }
            if query.isEmpty {
                Section {
                    NavigationLink(value: Route.galahad) { GalahadRow(now: session.galahad, expression: session.chat.answering ? "thinking" : session.galahad.tone == .warn ? "asking" : "idle", selected: chosen(.galahad)) }
                }
            }
            Section {
                ForEach(knights) { row in
                    NavigationLink(value: Route.knight(row.id)) { KnightRow(row: row, look: look(of: row), temper: AvatarLook.temperament(id: row.id, profile: session.teammate(row.id)?.avatar), selected: chosen(.knight(row.id))) }
                }
            } header: {
                if !knights.isEmpty { Text("Knights") }
            } footer: {
                if let problem = session.teamProblem {
                    Text(problem)
                } else if session.team != nil, session.rows.isEmpty {
                    Text("No other knights yet. Seat one with +: a name, a lasting job and a workspace of its own.")
                }
            }
            if !rooms.isEmpty {
                Section("Rooms") {
                    ForEach(rooms) { row in
                        NavigationLink(value: Route.room(row.id)) { RoomRowView(row: row, looks: looks(of: row), selected: chosen(.room(row.id))) }
                    }
                }
            }
        }
        // An iPad fills the selected row with the tint and writes its words in white: the ink does on light, but on dark
        // the ink is cream, and white on it couldn't be read; there the system's grey holds the selection. (Only the
        // list's own tint: its bar's buttons and its sheets keep the ink.)
        .tint(scheme == .dark ? Color(uiColor: .systemGray3) : .ink)
        .navigationTitle("Roundtable")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { RoundtableMark(size: 28) }
                .sharedBackgroundVisibility(.hidden)
            // The Roundtable's own work: given to it, the knight best suited takes it.
            ToolbarItem(placement: .topBarTrailing) {
                Button { giving = true } label: { Label("Give the Roundtable a task", systemImage: "hammer") }
                    .disabled(!session.can("fleet:admin") || session.rows.isEmpty)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { seating = true } label: { Label("New knight", systemImage: "person.badge.plus") }
                    Button { gathering = true } label: { Label("New room", systemImage: "bubble.left.and.bubble.right") }
                        .disabled(session.rows.isEmpty)
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .disabled(!session.can("fleet:admin") || session.team == nil)
            }
        }
        .sheet(isPresented: $giving) { GiveSheet(session: session) }
        .sheet(isPresented: $seating) { KnightEditor(session: session) { open(.knight($0.id)) } }
        .sheet(isPresented: $gathering) { RoomEditor(session: session) { open(.room($0.id)) } }
        .searchable(text: $query, prompt: "Knights")
        .refreshable { await session.refresh() }
        .overlay {
            if session.team == nil, session.teamProblem == nil, session.trouble == nil { ProgressView() }
        }
    }

    /// The row the detail column shows, on an iPad.
    private func chosen(_ route: Route) -> Bool { selection?.wrappedValue == route }

    private func look(of row: RosterRow) -> String {
        let knight = session.teammate(row.id)
        return AvatarLook.of(id: row.id, name: row.name, profile: knight?.avatar)
    }

    private func looks(of row: RoomRow) -> [String] {
        row.members.map { id in
            let knight = session.teammate(id)
            return AvatarLook.of(id: id, name: knight?.name ?? id, profile: knight?.avatar)
        }
    }
}

/// A row of the Roundtable, whoever's it is: a face in the one column every face stands in, a name, and what it is doing
/// in a line or two (always as tall as two, so a row keeps its height when its line changes), marked in Galahad's red
/// when it needs you.
struct RosterLine<Face: View>: View {
    let name: String
    let line: String
    let needs: Bool
    /// It is the row an iPad shows selected. On the list's ink Galahad's red line was hard to read (3.3 to 1) and the
    /// system's secondary grey harder, so its line takes no colour of its own there and turns as its name does; the mark
    /// beside it still says it needs you.
    var selected = false
    @ViewBuilder let face: Face

    var body: some View {
        HStack(spacing: Space.s3) {
            face.frame(width: Metrics.rowFace, height: Metrics.rowFace)
            VStack(alignment: .leading, spacing: Space.line) {
                Text(name).font(.headline)
                Group {
                    if selected { Text(line) } else { Text(line).foregroundStyle(needs ? Color.siege : .secondary) }
                }
                .font(.subheadline)
                .lineLimit(2, reservesSpace: true)
            }
            Spacer(minLength: 0)
            if needs { NeedsMark() }
        }
        .padding(.vertical, Space.s1)
        .accessibilityElement(children: .combine)
    }
}

struct GalahadRow: View {
    let now: GalahadNow
    /// What his face shows: thinking while he answers, asking while something waits for you.
    var expression = "idle"
    var selected = false

    var body: some View {
        RosterLine(name: "Galahad", line: now.text, needs: now.tone == .warn, selected: selected) {
            Portrait(drawing: "galahad", size: Metrics.rowFace, expression: expression, id: "galahad")
        }
    }
}

struct KnightRow: View {
    let row: RosterRow
    let look: String
    var temper = "calm"
    var selected = false

    var body: some View {
        RosterLine(name: row.name, line: row.line, needs: row.needs, selected: selected) {
            Portrait(drawing: look, size: Metrics.rowFace, expression: row.expression, id: row.id, temper: temper)
        }
    }
}

/// The node is away, or won't take this device's requests: said plainly, with what to do.
struct TroubleRow: View {
    let trouble: NodeError

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: Space.s1) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: trouble.unreachable ? "wifi.exclamationmark" : "lock.trianglebadge.exclamationmark").foregroundStyle(Color.siege)
        }
    }

    private var skew: TimeInterval? {
        trouble.serverTime.map { $0.timeIntervalSinceNow }.flatMap { abs($0) > 60 ? $0 : nil }
    }

    private var title: String {
        if trouble.unreachable { return "No connection to your node" }
        if skew != nil { return "This device's clock is off" }
        return trouble.status == 401 ? "The node doesn't accept this device" : "The node refused"
    }

    private var detail: String {
        if trouble.unreachable { return "\(trouble.message) On a phone, open the Tailscale app and check it says Connected." }
        if let skew { return "It is \(Int((abs(skew) / 60).rounded())) minutes from the node's. Set the date and time to set themselves, in Settings." }
        return trouble.status == 401 ? "It may have been removed from the fleet. Forget this device in More, then pair it again." : trouble.message
    }
}
