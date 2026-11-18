import SwiftUI

/*
 * The wide window's places, a Mac's and an iPad's alike (docs/MAC.md): a sidebar that is the Roundtable as the PWA's wide
 * screen has it (its mark, which opens its board; the one who leads, then the knights in your order, each face in the
 * ring of where it stands with its state in a word, dragged into another order; the rooms; then the Inbox and More), and
 * the place chosen beside it. A chat, a knight or a room also opens in a window of its own.
 */

/// What the wide window shows: Galahad's chat, the Roundtable's board, a knight's or a room's page, the Inbox, More, and
/// on a Mac, This Mac (its node).
enum Place: Hashable, Codable {
    case galahad, roundtable, inbox, more, thisMac
    case knight(String)
    case room(String)

    init(_ route: Route) {
        switch route {
        case .galahad: self = .galahad
        case .knight(let id): self = .knight(id)
        case .room(let id): self = .room(id)
        }
    }

    /// A seat at the Roundtable: Galahad's chat, or a knight's page.
    static func seat(_ id: String) -> Place { id == "galahad" ? .galahad : .knight(id) }
}

/// What a window of its own shows: one of Galahad's chats (by its id on the node), a knight's page, or a room's. Kept by
/// the system with the window, so it opens again where it was.
enum PlaceWindow: Hashable, Codable {
    case chat(String)
    case knight(String)
    case room(String)
}

extension Metrics {
    /// A face in the sidebar: smaller than a row's on an iPhone, as a sidebar is narrow and close at hand.
    static let sidebarFace: CGFloat = 32
    /// The column the sidebar's faces stand in, ring and all, so every name starts at one edge.
    static let sidebarSeat = sidebarFace + 2 * rowRing
}

/// The places, in a sidebar. Its foot is the window's to give: This Mac, on a Mac.
struct PlacesSidebar<Foot: View>: View {
    @Binding var place: Place
    let session: Session
    /// What stands at its foot, under what troubles the node: This Mac, on a Mac.
    let foot: Foot
    @Environment(\.openWindow) private var openWindow
    /// Whether a place can open in a window of its own: a Mac's, an iPad's (an iPhone has one window).
    @Environment(\.supportsMultipleWindows) private var windows
    /// The sidebar's two sections, folded at their heads as this Mac last left them (the PWA's choice to fold them).
    @AppStorage("sidebar.knights") private var knightsShown = true
    @AppStorage("sidebar.rooms") private var roomsShown = true
    /// A change of yours to the order, or to who leads, that didn't hold: what, and why.
    @State private var refused: (what: String, why: String)?

    init(place: Binding<Place>, session: Session, @ViewBuilder foot: () -> Foot) {
        _place = place
        self.session = session
        self.foot = foot()
    }

    private var mayArrange: Bool { session.can("fleet:admin") && session.team != nil }
    /// The head of the table: the one who leads, and Galahad after a knight that does.
    private var head: [String] { Array(session.seats.prefix(session.primary == "galahad" ? 1 : 2)) }
    /// The knights under it, in your order: those dragged into another.
    private var rest: [String] { Array(session.seats.dropFirst(head.count)) }

    var body: some View {
        // Each knight's row, worked out once for all of them.
        let rows = Dictionary(session.rows.map { ($0.id, $0) }) { first, _ in first }
        List(selection: Binding<Place?>(get: { place }, set: { if let chosen = $0 { place = chosen } })) {
            Section {
                Label {
                    Text("Roundtable").font(.headline)
                } icon: {
                    RoundtableMark(size: 20)
                }
                .padding(.vertical, Space.line)
                .tag(Place.roundtable)
                #if os(macOS)
                BuildRow()
                #endif
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
                        SidebarRoom(row: row, looks: looks(of: row)).tag(Place.room(row.id))
                    }
                }
            }
            Section {
                // What waits for you, counted in red as the iPhone's tab counts it.
                Label("Inbox", systemImage: "tray")
                    .badge(session.inboxCount)
                    .badgeProminence(session.inboxCount > 0 ? .increased : .standard)
                    .tag(Place.inbox)
                Label("More", systemImage: "ellipsis.circle").tag(Place.more)
            }
        }
        .listStyle(.sidebar)
        // Who leads, and your order, move the rows to their seats rather than putting them there.
        .animation(.default, value: session.seats)
        #if os(macOS)
        .contextMenu(forSelectionType: Place.self) { places in
            if let place = places.first, places.count == 1 { menu(for: place) }
        } primaryAction: { places in
            // A double click opens it in a window of its own.
            if let place = places.first, let window = window(for: place) { openWindow(value: window) }
        }
        #else
        // (A tap chooses a place, so a touch has no primary action here: a window of its own is in the row's menu.)
        .contextMenu(forSelectionType: Place.self) { places in
            if let place = places.first, places.count == 1 { menu(for: place) }
        }
        #endif
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                // What the model calls came to, against your budget.
                if session.usage != nil {
                    UsageMeterView(session: session)
                        .padding(.horizontal, Space.s4)
                        .padding(.vertical, Space.s3)
                }
                if let trouble = session.trouble {
                    TroubleRow(trouble: trouble)
                        .font(.callout)
                        .padding(Space.s3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.bar)
                }
                foot
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
                .tag(Place.galahad)
        } else if let row = rows[id] {
            let knight = session.teammate(id)
            SidebarSeat(name: row.name, line: row.line, needs: row.needs, standing: row.standing,
                        drawing: AvatarLook.of(id: id, name: row.name, profile: knight?.avatar), expression: row.expression, id: id,
                        temper: AvatarLook.temperament(id: id, profile: knight?.avatar), leads: session.primary == id)
                .tag(Place.knight(id))
        }
    }

    /// What a row's menu holds: a window of its own, and who leads.
    @ViewBuilder private func menu(for place: Place) -> some View {
        if windows, let window = window(for: place) {
            Button("Open in New Window", systemImage: "macwindow.badge.plus") { openWindow(value: window) }
        }
        let id: String? = switch place {
        case .galahad: "galahad"
        case .knight(let knight): knight
        default: nil
        }
        if let id, mayArrange {
            if id != "galahad", session.primary != id {
                Divider()
                Button("Make Primary", systemImage: "crown") { arrange("Who leads didn't change") { try await session.arrange(primary: id) } }
            } else if session.primary != "galahad" {
                Divider()
                Button("Galahad Leads", systemImage: "crown") { arrange("Who leads didn't change") { try await session.arrange(primary: "galahad") } }
            }
        }
    }

    /// The window of its own a place opens in: Galahad's chat on screen (once it is kept), a knight's page, a room's.
    private func window(for place: Place) -> PlaceWindow? {
        switch place {
        case .galahad: session.chat.conversation.map(PlaceWindow.chat)
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
/// than an iPhone's row, as a sidebar is; on the row a focused sidebar shows selected, it is all in the selection's white,
/// its line's red too (the chip still says it needs you).
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

/// A window of its own: a chat, a knight or a room, its pages pushed in it.
struct PlaceWindowView: View {
    let session: Session
    let window: PlaceWindow

    var body: some View {
        NavigationStack {
            switch window {
            case .chat(let id): ChatWindow(session: session, id: id)
            case .knight(let id): KnightView(session: session, id: id)
            case .room(let id): RoomView(session: session, id: id)
            }
        }
        .workspaceColumn(session: session, seat: seat)
    }

    /// The workspace a window's page can show beside it: a knight's, or his computer's beside a chat of Galahad's.
    private var seat: WorkspaceSeat? {
        switch window {
        case .chat: WorkspaceSeat(id: "galahad", name: "Galahad")
        case .knight(let id): WorkspaceSeat(id: id, name: session.teammate(id)?.name ?? id)
        case .room: nil
        }
    }
}

/// One of Galahad's chats in a window of its own: its own conversation, beside the one in the main window.
private struct ChatWindow: View {
    let session: Session
    let id: String
    @State private var chat = ChatModel()
    @State private var opened = false

    var body: some View {
        Group {
            if opened { ChatView(session: session, chat: chat) } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .task {
            await chat.open(id, with: session.client)
            opened = true
            // He may be answering in it for another device: looked at again every few seconds.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await chat.noticed(chats: nil, turns: session.turns, with: session.client)
            }
        }
    }
}

#if os(macOS)
/// The Build window, from the sidebar: a workbench with Galahad (docs/BUILD.md), in a window of its own.
private struct BuildRow: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button {
            openWindow(id: MacApp.build)
        } label: {
            Label("Build", systemImage: "hammer")
        }
        .buttonStyle(.plain)
        .help("Build with Galahad (⇧⌘B)")
    }
}
#endif
