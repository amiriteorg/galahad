import SwiftUI

/// Where a row of the Roundtable leads.
enum Route: Hashable {
    case galahad
    case knight(String)
}

/// The Roundtable: Galahad first, then every knight, each with its drawing and one line of what it is doing, marked in
/// Galahad's red when only you can move it on (lib/roster.ts says what each line is).
struct RoundtableView: View {
    let session: Session
    /// On an iPad, the row whose page the detail column shows; on an iPhone a row is pushed instead.
    var selection: Binding<Route?>? = nil
    @State private var query = ""

    private var knights: [RosterRow] {
        let rows = session.rows
        let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
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
                    NavigationLink(value: Route.galahad) { GalahadRow(now: session.galahad) }
                }
            }
            Section {
                ForEach(knights) { row in
                    NavigationLink(value: Route.knight(row.id)) { KnightRow(row: row, look: look(of: row)) }
                }
            } header: {
                if !knights.isEmpty { Text("Knights") }
            } footer: {
                if let problem = session.teamProblem {
                    Text(problem)
                } else if session.team != nil, session.rows.isEmpty {
                    Text("No other knights yet. Seat one from a terminal or the PWA: a name, a lasting job and a workspace of its own.")
                }
            }
        }
        .navigationTitle("Roundtable")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { RoundtableMark(size: 28) }
                .sharedBackgroundVisibility(.hidden)
        }
        .searchable(text: $query, prompt: "Knights")
        .refreshable { await session.refresh() }
        .overlay {
            if session.team == nil, session.teamProblem == nil, session.trouble == nil { ProgressView() }
        }
    }

    private func look(of row: RosterRow) -> String {
        let knight = session.teammate(row.id)
        return AvatarLook.of(id: row.id, name: row.name, profile: knight?.avatar)
    }
}

struct GalahadRow: View {
    let now: GalahadNow

    var body: some View {
        HStack(spacing: 14) {
            Portrait(drawing: "galahad", size: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text("Galahad").font(.headline)
                Text(now.text)
                    .font(.subheadline)
                    .foregroundStyle(now.tone == .warn ? Color.siege : .secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if now.tone == .warn { NeedsMark() }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

struct KnightRow: View {
    let row: RosterRow
    let look: String

    var body: some View {
        HStack(spacing: 14) {
            Portrait(drawing: look, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name).font(.headline)
                Text(row.line)
                    .font(.subheadline)
                    .foregroundStyle(row.needs ? Color.siege : .secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if row.needs { NeedsMark() }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// The node is away, or won't take this device's requests: said plainly, with what to do.
struct TroubleRow: View {
    let trouble: NodeError

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
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
