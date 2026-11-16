#if os(macOS)
import SwiftUI

extension Metrics {
    /// A face in the Mac's sidebar: smaller than a row's on an iPhone, as a sidebar is narrow and close at hand.
    static let sidebarFace: CGFloat = 32
    /// The column the sidebar's faces stand in, ring and all, so every name starts at one edge.
    static let sidebarSeat = sidebarFace + 2 * rowRing
}

/// The main window once this Mac is paired: the iPad's sidebar and detail. The sidebar is the Roundtable as the PWA's
/// wide screen has it: its mark, which opens its board; the one who leads, then the knights in your order, each face in
/// the ring of where it stands with its state in a word (dragged into another order, as a Mac's lists are); the rooms;
/// then the Inbox and More; and This Mac at its foot. The detail is the place chosen; a chat, a knight or a room also opens
/// in a window of its own.
struct MacPlaces: View {
    @Bindable var mac: MacApp
    let session: Session

    var body: some View {
        NavigationSplitView {
            MacSidebar(mac: mac, session: session)
                .navigationSplitViewColumnWidth(min: 250, ideal: 290, max: 380)
        } detail: {
            NavigationStack { detail }
                // Each place starts at its own root.
                .id(mac.place)
                .environment(\.composerWanted, $mac.composerWanted)
        }
        .sheet(isPresented: $mac.giving) { GiveSheet(session: session) }
        .task { await session.refresh() }
    }

    @ViewBuilder private var detail: some View {
        switch mac.place {
        case .galahad: ChatView(session: session)
        case .roundtable: RoundtableView(session: session, selection: board) { mac.place = MacPlace($0) }
        case .knight(let id): KnightView(session: session, id: id)
        case .room(let id): RoomView(session: session, id: id)
        case .inbox: InboxView(session: session)
        case .more: MoreView(app: mac.app, session: session)
        case .thisMac: GroupedList { ThisMacSections(mac: mac) }.navigationTitle("This Mac")
        }
    }

    /// The board's rows lead to their pages in this window: chosen there, they are chosen in the sidebar.
    private var board: Binding<Route?> {
        Binding(get: { nil }, set: { route in if let route { mac.place = MacPlace(route) } })
    }
}

private struct MacSidebar: View {
    @Bindable var mac: MacApp
    let session: Session
    @Environment(\.openWindow) private var openWindow
    /// The sidebar's two sections, folded at their heads as this Mac last left them (the PWA's choice to fold them).
    @AppStorage("sidebar.knights") private var knightsShown = true
    @AppStorage("sidebar.rooms") private var roomsShown = true
    /// A change of yours to the order, or to who leads, that didn't hold: what, and why.
    @State private var refused: (what: String, why: String)?

    private var mayArrange: Bool { session.can("fleet:admin") && session.team != nil }
    /// The head of the table: the one who leads, and Galahad after a knight that does.
    private var head: [String] { Array(session.seats.prefix(session.primary == "galahad" ? 1 : 2)) }
    /// The knights under it, in your order: those dragged into another.
    private var rest: [String] { Array(session.seats.dropFirst(head.count)) }

    var body: some View {
        // Each knight's row, worked out once for all of them.
        let rows = Dictionary(session.rows.map { ($0.id, $0) }) { first, _ in first }
        List(selection: Binding<MacPlace?>(get: { mac.place }, set: { if let place = $0 { mac.place = place } })) {
            Section {
                Label {
                    Text("Roundtable").font(.headline)
                } icon: {
                    RoundtableMark(size: 20)
                }
                .padding(.vertical, Space.line)
                .tag(MacPlace.roundtable)
                ForEach(head, id: \.self) { id in seat(id, rows) }
            }
            if !rest.isEmpty {
                Section("Knights", isExpanded: $knightsShown) {
                    ForEach(rest, id: \.self) { id in seat(id, rows) }
                        .onMove(perform: mayArrange ? { offsets, destination in move(offsets, to: destination) } : nil)
                }
            }
            if !session.roomRows.isEmpty {
                Section("Rooms", isExpanded: $roomsShown) {
                    ForEach(session.roomRows) { row in
                        SidebarRoom(row: row, looks: looks(of: row)).tag(MacPlace.room(row.id))
                    }
                }
            }
            Section {
                // What waits for you, counted in red as the iPhone's tab counts it.
                Label("Inbox", systemImage: "tray")
                    .badge(session.inboxCount)
                    .badgeProminence(session.inboxCount > 0 ? .increased : .standard)
                    .tag(MacPlace.inbox)
                Label("More", systemImage: "ellipsis.circle").tag(MacPlace.more)
            }
        }
        .listStyle(.sidebar)
        // Who leads, and your order, move the rows to their seats rather than putting them there.
        .animation(.default, value: session.seats)
        .contextMenu(forSelectionType: MacPlace.self) { places in
            if let place = places.first, places.count == 1 { menu(for: place) }
        } primaryAction: { places in
            // A double click opens it in a window of its own.
            if let place = places.first, let window = window(for: place) { openWindow(value: window) }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if let trouble = session.trouble {
                    TroubleRow(trouble: trouble)
                        .font(.callout)
                        .padding(Space.s3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.bar)
                }
                ThisMacFoot(mac: mac)
            }
        }
        .alert(refused?.what ?? "", isPresented: .init(get: { refused != nil }, set: { if !$0 { refused = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(refused?.why ?? "")
        }
    }

    /// A seat: Galahad's chat, or a knight's page.
    @ViewBuilder private func seat(_ id: String, _ rows: [String: RosterRow]) -> some View {
        if id == "galahad" {
            SidebarSeat(name: "Galahad", line: session.galahad.text, needs: session.galahad.tone == .warn, standing: session.galahadStanding,
                        drawing: "galahad", expression: session.galahadExpression, id: id, leads: session.primary == id)
                .tag(MacPlace.galahad)
        } else if let row = rows[id] {
            let knight = session.teammate(id)
            SidebarSeat(name: row.name, line: row.line, needs: row.needs, standing: row.standing,
                        drawing: AvatarLook.of(id: id, name: row.name, profile: knight?.avatar), expression: row.expression, id: id,
                        temper: AvatarLook.temperament(id: id, profile: knight?.avatar), leads: session.primary == id)
                .tag(MacPlace.knight(id))
        }
    }

    /// What a row's menu holds: a window of its own, and who leads.
    @ViewBuilder private func menu(for place: MacPlace) -> some View {
        if let window = window(for: place) {
            Button("Open in New Window") { openWindow(value: window) }
        }
        let id: String? = switch place {
        case .galahad: "galahad"
        case .knight(let knight): knight
        default: nil
        }
        if let id, mayArrange {
            if id != "galahad", session.primary != id {
                Divider()
                Button("Make Primary") { arrange("Who leads didn't change") { try await session.arrange(primary: id) } }
            } else if session.primary != "galahad" {
                Divider()
                Button("Galahad Leads") { arrange("Who leads didn't change") { try await session.arrange(primary: "galahad") } }
            }
        }
    }

    /// The window of its own a place opens in: Galahad's chat on screen (once it is kept), a knight's page, a room's.
    private func window(for place: MacPlace) -> MacWindow? {
        switch place {
        case .galahad: session.chat.conversation.map(MacWindow.chat)
        case .knight(let id): .knight(id)
        case .room(let id): .room(id)
        case .roundtable, .inbox, .more, .thisMac: nil
        }
    }

    /// The knights under the one who leads, dragged into another order.
    private func move(_ offsets: IndexSet, to destination: Int) {
        let order = Roster.order(session.order, leader: Roster.leader(of: session.order, primary: session.primary), moving: offsets, to: destination)
        arrange("Your order didn't change") { try await session.arrange(order: order) }
    }

    /// A change to the arrangement, shown at once, then saved; refused, the rows go back and `what` is said, with why.
    private func arrange(_ what: String, _ change: @escaping @MainActor () async throws -> Void) {
        Task.immediate {
            do { try await change() } catch { refused = (what, error.localizedDescription) }
        }
    }

    private func looks(of row: RoomRow) -> [String] {
        row.members.map { id in
            let knight = session.teammate(id)
            return AvatarLook.of(id: id, name: knight?.name ?? id, profile: knight?.avatar)
        }
    }
}

/// A seat in the sidebar: its face in the ring of where it stands (the one who leads with its mark on the ring's foot), its
/// name and its state in a word, and what it is doing in a line, in Galahad's red when only you can move it on. Smaller
/// than an iPhone's row, as a Mac's sidebar is; on the row a focused sidebar shows selected, it is all in the selection's
/// white, its line's red too (the chip still says it needs you).
struct SidebarSeat: View {
    let name: String
    let line: String
    let needs: Bool
    let standing: Standing
    let drawing: String
    var expression: String? = nil
    var id = ""
    var temper = "calm"
    var leads = false
    @Environment(\.backgroundProminence) private var prominence

    var body: some View {
        let selected = prominence == .increased
        HStack(spacing: Space.s2) {
            SeatFace(drawing: drawing, size: Metrics.sidebarFace, expression: expression, id: id, temper: temper, standing: standing, leads: leads, selected: selected)
                .frame(width: Metrics.sidebarSeat, height: Metrics.sidebarSeat)
            VStack(alignment: .leading, spacing: Space.line) {
                HStack(alignment: .firstTextBaseline, spacing: Space.s1) {
                    Text(name).font(.headline).lineLimit(1)
                    Spacer(minLength: 0)
                    if let word = standing.word {
                        StateBadge(text: word, tone: standing.tone, selected: selected).fixedSize()
                    }
                }
                // Beside its chip, the line doesn't say the chip's word again; always a line high, so rows keep their height.
                let said = standing.beside(line)
                Text(said.isEmpty ? " " : said)
                    .font(.subheadline)
                    .foregroundStyle(needs && !selected ? AnyShapeStyle(Color.siege) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
            }
        }
        .padding(.vertical, Space.s1)
        // Room under the face for the mark the one who leads wears on its ring's foot.
        .padding(.bottom, leads ? Space.s1 : 0)
        // Its whole line, where the sidebar cut it short.
        .help(line)
        .accessibilityElement(children: .combine)
    }
}

/// A room in the sidebar: who is in it (up to three faces, where a knight's face stands), its name, and where it stands in
/// a line, with the mark of what needs you.
private struct SidebarRoom: View {
    let row: RoomRow
    let looks: [String]
    @Environment(\.backgroundProminence) private var prominence

    var body: some View {
        let selected = prominence == .increased
        HStack(spacing: Space.s2) {
            let shown = Array(looks.prefix(3))
            ZStack {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, look in
                    Portrait(drawing: look, size: Metrics.sidebarFace * 0.62)
                        .offset(x: (CGFloat(index) - CGFloat(shown.count - 1) / 2) * Metrics.sidebarFace * 0.24, y: index % 2 == 0 ? -Space.line : Space.line)
                }
            }
            .frame(width: Metrics.sidebarSeat, height: Metrics.sidebarSeat)
            VStack(alignment: .leading, spacing: Space.line) {
                Text(row.name).font(.headline).lineLimit(1)
                Text(row.line)
                    .font(.subheadline)
                    .foregroundStyle(row.needs && !selected ? AnyShapeStyle(Color.siege) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if row.needs { NeedsMark() }
        }
        .padding(.vertical, Space.s1)
        .help(row.line)
        .accessibilityElement(children: .combine)
    }
}
#endif
