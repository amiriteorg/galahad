import SwiftUI

/// Where a row of the Roundtable leads.
enum Route: Hashable {
    case galahad
    case knight(String)
    case room(String)
}

/// The Roundtable: the one who leads first (Galahad, unless you made a knight primary, who then has Galahad after it),
/// then every knight in your order, each with its drawing in a ring of where it stands and one line of what it is
/// doing, marked in Galahad's red when only you can move it on (lib/roster.ts says what each line is). Edit moves the
/// knights; on an iPad they can be cards instead of rows, as the device remembers.
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
    #if os(iOS)
    @State private var editing = EditMode.inactive
    #endif
    /// A change of yours to the order, or to who leads, that didn't hold: what, and why.
    @State private var refused: (what: String, why: String)?
    /// Beside a sidebar that lists the knights (an iPad's, a Mac's), the Roundtable's own page is its board, every knight a
    /// card (the PWA's on a wide screen), until you choose its list.
    @AppStorage("roundtable.cards") private var asCards = true
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var words: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var mayArrange: Bool { session.can("fleet:admin") && session.team != nil }
    /// Cards are offered where there is room for them: the page beside a sidebar (an iPhone pushes its rows instead).
    private var cardsOffered: Bool { selection != nil }
    private var cards: Bool { cardsOffered && asCards }
    /// Edit is moving the knights. A Mac has no Edit: its list is put in order by dragging, as its lists are.
    private var editingRows: Bool {
        #if os(iOS)
        editing.isEditing
        #else
        false
        #endif
    }

    /// The head of the table: the one who leads, and Galahad after a knight that does.
    private var head: [String] { Array(session.seats.prefix(session.primary == "galahad" ? 1 : 2)) }
    /// The knights under it, in your order: those Edit moves.
    private var rest: [String] { Array(session.seats.dropFirst(head.count)) }
    /// While you search, the knights it finds, in their seats' order.
    private func found(in rows: [String: RosterRow]) -> [String] {
        session.seats.filter { id in rows[id].map { $0.name.localizedStandardContains(words) || $0.line.localizedStandardContains(words) } ?? false }
    }

    private var rooms: [RoomRow] {
        let rows = session.roomRows
        guard !words.isEmpty else { return rows }
        return rows.filter { $0.name.localizedStandardContains(words) || $0.line.localizedStandardContains(words) }
    }

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var width
    #endif

    var body: some View {
        List(selection: selection) {
            if let trouble = session.trouble {
                Section { TroubleRow(trouble: trouble) }
            }
            #if os(iOS)
            // What the model calls came to, against your budget (an iPad has it at its sidebar's foot).
            if width == .compact, session.usage != nil {
                Section { UsageMeterView(session: session) }
            }
            #endif
            knights
            if !rooms.isEmpty {
                Section("Rooms") {
                    ForEach(rooms) { row in
                        NavigationLink(value: Route.room(row.id)) { RoomRowView(row: row, looks: looks(of: row), selected: chosen(.room(row.id))) }
                    }
                }
            }
        }
        #if os(iOS)
        .environment(\.editMode, $editing)
        #endif
        // Who leads, and your order, move the rows to their seats rather than putting them there.
        .animation(reduceMotion ? nil : .default, value: session.seats)
        // An iPad fills the selected row with the tint and writes its words in white: the ink does on light, but on dark
        // the ink is cream, and white on it couldn't be read; there the system's grey holds the selection. (Only the
        // list's own tint: its bar's buttons and its sheets keep the ink.)
        .tint(scheme == .dark ? Color.selectionOnDark : .ink)
        .navigationTitle("Roundtable")
        .toolbar { bar }
        // Said where you are, however far down the list the change was made; the rows are back as they were.
        .alert(refused?.what ?? "", isPresented: .init(get: { refused != nil }, set: { if !$0 { refused = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(refused?.why ?? "")
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

    /// Galahad and the knights: as cards; as rows, the head of the table above the knights Edit moves; or what a search finds.
    @ViewBuilder private var knights: some View {
        // Each knight's row, worked out once for all of them.
        let rows = Dictionary(session.rows.map { ($0.id, $0) }) { first, _ in first }
        if cards {
            Section {
                CardGrid {
                    ForEach(words.isEmpty ? session.seats : found(in: rows), id: \.self) { id in card(id, rows) }
                }
            } footer: {
                footer
            }
        } else if words.isEmpty {
            Section {
                ForEach(head, id: \.self) { id in seat(id, rows) }
            }
            Section {
                ForEach(rest, id: \.self) { id in seat(id, rows) }
                    .onMove(perform: mayArrange ? { offsets, destination in move(offsets, to: destination) } : nil)
            } header: {
                if !rest.isEmpty { Text("Knights") }
            } footer: {
                footer
            }
        } else {
            let matches = found(in: rows)
            Section {
                ForEach(matches, id: \.self) { id in seat(id, rows) }
            } header: {
                if !matches.isEmpty { Text("Knights") }
            } footer: {
                footer
            }
        }
    }

    @ToolbarContentBuilder private var bar: some ToolbarContent {
        #if os(iOS)
        ToolbarItem(placement: .topBarLeading) { RoundtableMark(size: 28) }
            .sharedBackgroundVisibility(.hidden)
        if editing.isEditing {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { withAnimation { editing = .inactive } }
            }
        } else {
            actions
            if mayArrange, !cards, words.isEmpty, rest.count > 1 {
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { withAnimation { editing = .active } }
                }
            }
        }
        #else
        // (On a Mac the mark heads the sidebar, as the PWA's wide screen has it.)
        actions
        #endif
    }

    @ToolbarContentBuilder private var actions: some ToolbarContent {
        // The Roundtable's own work: given to it, the knight best suited takes it.
        ToolbarItem(placement: .barTrailing) {
            Button { giving = true } label: { Label("Give the Roundtable a task", systemImage: "hammer") }
                .disabled(!session.can("fleet:admin") || session.rows.isEmpty)
        }
        ToolbarItem(placement: .barTrailing) {
            Menu {
                Button { seating = true } label: { Label("New knight", systemImage: "person.badge.plus") }
                Button { gathering = true } label: { Label("New room", systemImage: "bubble.left.and.bubble.right") }
                    .disabled(session.rows.isEmpty)
            } label: {
                Label("Add", systemImage: "plus")
            }
            .disabled(!session.can("fleet:admin") || session.team == nil)
        }
        if cardsOffered {
            ToolbarItem(placement: .barTrailing) {
                Button { asCards.toggle() } label: {
                    Label(asCards ? "Show as a list" : "Show as cards", systemImage: asCards ? "list.bullet" : "square.grid.2x2")
                }
            }
        }
    }

    @ViewBuilder private var footer: some View {
        if let problem = session.teamProblem {
            Text(problem)
        } else if session.team != nil, session.rows.isEmpty {
            Text("No other knights yet. Seat one with +: a name, a lasting job and a workspace of its own.")
        }
    }

    /// A seat as a row: Galahad's chat, or a knight's page.
    @ViewBuilder private func seat(_ id: String, _ rows: [String: RosterRow]) -> some View {
        if id == "galahad" {
            opening(.galahad) {
                GalahadRow(now: session.galahad, expression: galahadExpression, standing: galahadStanding, leads: session.primary == id, selected: chosen(.galahad))
            }
            .contextMenu { leading(id) }
        } else if let row = rows[id] {
            opening(.knight(id)) {
                KnightRow(row: row, look: look(of: row), temper: temper(of: id), leads: session.primary == id, selected: chosen(.knight(id)))
            }
            .contextMenu { leading(id) }
        }
    }

    /// A row that opens its page; while Edit moves the knights, only the row, with no way on beside its handle.
    @ViewBuilder private func opening<Row: View>(_ route: Route, @ViewBuilder row: () -> Row) -> some View {
        if editingRows { row() } else { NavigationLink(value: route, label: row) }
    }

    /// A seat as a card: the same, with its face large.
    @ViewBuilder private func card(_ id: String, _ rows: [String: RosterRow]) -> some View {
        let route = id == "galahad" ? Route.galahad : Route.knight(id)
        Button { open(route) } label: {
            if id == "galahad" {
                SeatCard(name: "Galahad", line: session.galahad.text, needs: session.galahad.tone == .warn, standing: galahadStanding, selected: chosen(route)) {
                    SeatFace(drawing: "galahad", size: Metrics.cardFace, expression: galahadExpression, id: id, standing: galahadStanding, leads: session.primary == id)
                }
            } else if let row = rows[id] {
                SeatCard(name: row.name, line: row.line, needs: row.needs, standing: row.standing, selected: chosen(route)) {
                    SeatFace(drawing: look(of: row), size: Metrics.cardFace, expression: row.expression, id: id, temper: temper(of: id), standing: row.standing, leads: session.primary == id)
                }
            }
        }
        .buttonStyle(.plain)
        .contextMenu { leading(id) }
    }

    /// Who leads, from a seat's menu: a knight is made primary; Galahad takes the lead back.
    @ViewBuilder private func leading(_ id: String) -> some View {
        if mayArrange {
            if id != "galahad", session.primary != id {
                Button { arrange("Who leads didn't change") { try await session.arrange(primary: id) } } label: { Label("Make primary", systemImage: "arrow.up.to.line") }
            } else if session.primary != "galahad" {
                Button { arrange("Who leads didn't change") { try await session.arrange(primary: "galahad") } } label: { Label("Galahad leads", systemImage: "arrow.uturn.backward") }
            }
        }
    }

    /// The knights under the one who leads, moved by hand in Edit.
    private func move(_ offsets: IndexSet, to destination: Int) {
        let order = Roster.order(session.order, leader: Roster.leader(of: session.order, primary: session.primary), moving: offsets, to: destination)
        arrange("Your order didn't change") { try await session.arrange(order: order) }
    }

    /// A change to the arrangement, shown before this returns (a list wants a row it moved where it was put at once), then
    /// saved; refused, the rows go back and `what` is said, with why.
    private func arrange(_ what: String, _ change: @escaping @MainActor () async throws -> Void) {
        Task.immediate {
            do { try await change() } catch { refused = (what, error.localizedDescription) }
        }
    }

    private var galahadExpression: String { session.galahadExpression }
    private var galahadStanding: Standing { session.galahadStanding }

    /// The row the detail column shows, on an iPad.
    private func chosen(_ route: Route) -> Bool { selection?.wrappedValue == route }

    private func look(of row: RosterRow) -> String {
        let knight = session.teammate(row.id)
        return AvatarLook.of(id: row.id, name: row.name, profile: knight?.avatar)
    }

    private func temper(of id: String) -> String { AvatarLook.temperament(id: id, profile: session.teammate(id)?.avatar) }

    private func looks(of row: RoomRow) -> [String] {
        row.members.map { id in
            let knight = session.teammate(id)
            return AvatarLook.of(id: id, name: knight?.name ?? id, profile: knight?.avatar)
        }
    }
}

/// A row of the Roundtable, whoever's it is: a face in the one column every face stands in, a name, and what it is doing
/// in a line or two (always as tall as two, so a row keeps its height when its line changes), marked in Galahad's red
/// when it needs you. A knight's and Galahad's say where they stand in a word beside the name (under it, at the largest
/// sizes).
struct RosterLine<Face: View>: View {
    let name: String
    let line: String
    let needs: Bool
    /// Where it stands, in a word; nil: a room, which has only its mark when it needs you.
    var standing: Standing? = nil
    /// It is the row an iPad shows selected. On the list's ink Galahad's red line was hard to read (3.3 to 1) and the
    /// system's secondary grey harder, so its line takes no colour of its own there and turns as its name does; the mark
    /// beside it still says it needs you.
    var selected = false
    @ViewBuilder let face: Face
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: Space.s3) {
            face.frame(width: Metrics.rowSeat, height: Metrics.rowSeat)
            VStack(alignment: .leading, spacing: Space.line) {
                // Its word is always there, so a row is as tall whatever it says.
                if typeSize.isAccessibilitySize {
                    Text(name).font(.headline).lineLimit(1)
                    if let standing { chip(standing) }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
                        Text(name).font(.headline).lineLimit(1)
                        Spacer(minLength: 0)
                        if let standing { chip(standing).fixedSize() }
                    }
                }
                // Beside its chip, the line doesn't say the chip's word again.
                let said = standing?.beside(line) ?? line
                Group {
                    if selected { Text(said) } else { Text(said).foregroundStyle(needs ? Color.siege : .secondary) }
                }
                .font(.subheadline)
                .lineLimit(2, reservesSpace: true)
            }
            if standing == nil {
                Spacer(minLength: 0)
                if needs { NeedsMark() }
            }
        }
        .padding(.vertical, Space.s1)
        .accessibilityElement(children: .combine)
    }

    /// Its state in a word; at rest, which says none, the chip's place is kept, so a row is as tall whatever it says.
    @ViewBuilder private func chip(_ standing: Standing) -> some View {
        if let word = standing.word {
            StateBadge(text: word, tone: standing.tone, selected: selected)
        } else {
            StateBadge(text: "Queued", tone: "neutral").hidden().accessibilityHidden(true)
        }
    }
}

struct GalahadRow: View {
    let now: GalahadNow
    /// What his face shows: thinking while he answers, asking while something waits for you.
    var expression = "idle"
    var standing = Standing.resting
    var leads = false
    var selected = false

    var body: some View {
        RosterLine(name: "Galahad", line: now.text, needs: now.tone == .warn, standing: standing, selected: selected) {
            SeatFace(drawing: "galahad", size: Metrics.rowFace, expression: expression, id: "galahad", standing: standing, leads: leads, selected: selected)
        }
    }
}

struct KnightRow: View {
    let row: RosterRow
    let look: String
    var temper = "calm"
    var leads = false
    var selected = false

    var body: some View {
        RosterLine(name: row.name, line: row.line, needs: row.needs, standing: row.standing, selected: selected) {
            SeatFace(drawing: look, size: Metrics.rowFace, expression: row.expression, id: row.id, temper: temper, standing: row.standing, leads: leads, selected: selected)
        }
    }
}

/// A seat at the Roundtable as a card, chosen on an iPad in place of the rows: the face large enough for its eyes to
/// follow its work, its name, where it stands in a word, and what it is doing in two lines (always as tall as two).
struct SeatCard<Face: View>: View {
    let name: String
    let line: String
    let needs: Bool
    let standing: Standing
    /// The seat the detail column shows: ringed in the ink.
    var selected = false
    @ViewBuilder let face: Face

    var body: some View {
        VStack(spacing: Space.s2) {
            // Room under every face for the mark the one who leads wears on its ring, so cards side by side match.
            face.padding(.bottom, Space.s2)
            Text(name).font(.headline).lineLimit(1)
            if let word = standing.word {
                StateBadge(text: word, tone: standing.tone)
            } else {
                StateBadge(text: "Queued", tone: "neutral").hidden().accessibilityHidden(true)
            }
            // (An empty line reserves no room: a space does, so a card with nothing to say is as tall as the rest.)
            let said = standing.beside(line)
            Text(said.isEmpty ? " " : said)
                .font(.footnote)
                .foregroundStyle(needs ? Color.siege : .secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2, reservesSpace: true)
        }
        .padding(Space.s3)
        .frame(maxWidth: .infinity)
        .background(Color.raised, in: .rect(cornerRadius: Metrics.cardRadius, style: .continuous))
        .overlay {
            if selected { RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous).strokeBorder(Color.ink, lineWidth: 2) }
        }
        .contentShape(.rect(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Cards in as many columns as the list has room for, on the list's own ground rather than in a row of it.
private struct CardGrid<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: Metrics.cardWidth), spacing: Space.s3, alignment: .top)], spacing: Space.s3) { content }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
    }
}

/// A face at the Roundtable in the ring of where it stands, the one who leads with its mark on the ring's foot. The ring
/// and the mark are drawn round the drawing, never over it.
struct SeatFace: View {
    let drawing: String
    let size: CGFloat
    var expression: String? = nil
    var id = ""
    var temper = "calm"
    let standing: Standing
    var leads = false
    var selected = false

    var body: some View {
        let ring = size >= Metrics.cardFace ? Metrics.cardRing : Metrics.rowRing
        Portrait(drawing: drawing, size: size, expression: expression, id: id, temper: temper)
            .padding(ring)
            .overlay { StandingRing(kind: standing, width: ring * 0.6, selected: selected) }
            // Its middle on the ring's foot, whatever its size.
            .overlay { if leads { LeadsMark().offset(y: size / 2 + ring) } }
    }
}

/// The ring round a face, in the colour of where it stands (the PWA's seat): the ink at work (a stroke of it going round,
/// still when the device asks for less motion), Galahad's red when it needs you or its work failed, green for work that
/// passed review a moment ago, grey while queued, dashed grey while paused, a hairline at rest. On a row an iPad shows
/// selected, white, as the row's words are.
struct StandingRing: View {
    let kind: Standing
    let width: CGFloat
    var selected = false

    var body: some View {
        switch kind {
        case .working:
            // Still, as every state's ring is (the owner's word: nothing at the table spins): the ink says it.
            Circle().strokeBorder(selected ? Color.white : .ink, lineWidth: width)
        case .needs, .failed:
            Circle().strokeBorder(selected ? Color.white : .siege, lineWidth: width)
        case .verified:
            Circle().strokeBorder(selected ? Color.white : .green, lineWidth: width)
        case .queued:
            Circle().strokeBorder(selected ? Color.white : .secondary, lineWidth: width)
        case .paused:
            Circle().strokeBorder(selected ? Color.white : .secondary, style: StrokeStyle(lineWidth: width, dash: [width * 1.5, width * 1.5]))
        case .resting:
            Circle().strokeBorder(selected ? Color.white.opacity(0.5) : Color.hairline, lineWidth: 1)
        }
    }
}

extension Standing {
    /// As a badge takes it: the ink at work, Galahad's red when it needs you or failed, green when verified, grey otherwise.
    var tone: String {
        switch self {
        case .working: "accent"
        case .needs, .failed: "danger"
        case .verified: "ok"
        case .paused, .queued, .resting: "neutral"
        }
    }
}

/// The mark of the one who leads the Roundtable (Galahad, or the knight you made primary), on the foot of its ring: the
/// ink on the row's own ground, so it reads on a row an iPad shows selected too.
struct LeadsMark: View {
    var body: some View {
        Text("Leads")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Color.ink)
            .padding(.horizontal, Space.s1)
            .padding(.vertical, Space.line)
            .background(Color.rowGround, in: .capsule)
            .overlay(Capsule().strokeBorder(Color.ink, lineWidth: 1))
            .fixedSize()
            // No wider than the face it sits on, which keeps its size; the row's words say it too, to VoiceOver.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityLabel("Leads the Roundtable")
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
