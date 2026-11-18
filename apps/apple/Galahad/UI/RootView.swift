import SwiftUI

#if os(iOS)
/// Pairing until this device is in the fleet; the app itself after.
struct RootView: View {
    let app: AppModel

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                ProgressView()
            case .unpaired:
                JoinView(app: app)
            case .paired(let session):
                MainView(app: app, session: session)
            case .broken(let why):
                KeyUnreadable(why: why) { app.start() }
            }
        }
        .tint(.ink)
        .background(WindowTint())
        .task { app.start() }
    }
}

/// Gives the window it is in the ink as its tint. The root's .tint reaches what SwiftUI draws, but a sheet's rows are
/// first drawn with the window's own, which stayed system blue whatever the asset catalog's accent (iOS 26.1).
private struct WindowTint: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { Probe() }
    func updateUIView(_ view: UIView, context: Context) {}

    final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            window?.tintColor = UIColor(named: "AccentColor")
        }
    }
}

/// The paired app, asked again every few seconds while a window of it is in front. On an iPhone (and an iPad's narrow
/// window), three tabs; on an iPad, a Mac's window: the places in a sidebar and the place chosen beside them.
struct MainView: View {
    let app: AppModel
    let session: Session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var width

    var body: some View {
        Group {
            if width == .compact {
                PhoneTabs(app: app, session: session)
            } else {
                SplitPlaces(app: app, session: session)
            }
        }
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            // Back in the app: the chat on screen as the node holds it now (an answer it was watching may have gone on).
            await session.chat.resume(with: session.client)
            await app.keepFresh(session)
        }
    }
}

/// An iPhone's tabs.
enum PhoneTab: Hashable {
    case roundtable, inbox, more
}

struct PhoneTabs: View {
    let app: AppModel
    let session: Session
    @State private var tab: PhoneTab = .roundtable
    @State private var path: [Route] = []

    var body: some View {
        TabView(selection: $tab) {
            Tab("Roundtable", systemImage: "person.3", value: PhoneTab.roundtable) {
                NavigationStack(path: $path) {
                    RoundtableView(session: session) { path.append($0) }
                        .navigationDestination(for: Route.self) { RouteView(session: session, route: $0) }
                }
            }
            Tab("Inbox", systemImage: "tray", value: PhoneTab.inbox) {
                NavigationStack { InboxView(session: session) }
            }
            .badge(session.inboxCount)
            Tab("More", systemImage: "ellipsis.circle", value: PhoneTab.more) {
                NavigationStack { MoreView(app: app, session: session) }
            }
        }
        .task(id: PushCenter.shared.opened) { await follow() }
    }

    /// A notification you tapped: its place, and on the Roundtable the page it names.
    private func follow() async {
        guard let opened = PushCenter.shared.opened else { return }
        PushCenter.shared.opened = nil
        switch opened {
        case .inbox: tab = .inbox
        case .settings: tab = .more
        case .overview: tab = .roundtable; path = []
        case .chat(let id):
            tab = .roundtable
            path = [.galahad]
            if let id { await session.chat.open(id, with: session.client) }
        }
    }
}

/// An iPad's window, as a Mac's: the places in a sidebar (Places.swift) and the place chosen beside them. Each window
/// keeps its own place for the next launch, and the menus and their keys (PadCommands) act in the one in front.
struct SplitPlaces: View {
    let app: AppModel
    let session: Session
    /// The place this window shows, kept with the window.
    @SceneStorage("place") private var kept = ""
    @State private var giving = false
    @State private var composerWanted = false

    private var place: Place {
        get { (try? JSONDecoder().decode(Place.self, from: Data(kept.utf8))) ?? .galahad }
        nonmutating set { kept = (try? JSONEncoder().encode(newValue)).map { String(decoding: $0, as: UTF8.self) } ?? "" }
    }

    var body: some View {
        NavigationSplitView {
            PlacesSidebar(place: Binding(get: { place }, set: { place = $0 }), session: session) { EmptyView() }
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
        } detail: {
            NavigationStack { detail }
                // Each place starts at its own root.
                .id(place)
                .environment(\.composerWanted, $composerWanted)
                // A knight's workspace (his computer's, beside his chat) in a column of its own.
                .workspaceColumn(session: session, seat: place.workspaceSeat(session))
        }
        .sheet(isPresented: $giving) { GiveSheet(session: session) }
        .focusedSceneValue(\.placeActions, PlaceActions(go: { place = $0 }, newChat: newChat, give: mayGive ? { giving = true } : nil))
        .task(id: PushCenter.shared.opened) { await follow() }
    }

    @ViewBuilder private var detail: some View {
        switch place {
        case .galahad: ChatView(session: session)
        case .roundtable: RoundtableView(session: session, selection: board) { place = Place($0) }
        case .knight(let id): KnightView(session: session, id: id)
        case .room(let id): RoomView(session: session, id: id)
        case .inbox: InboxView(session: session)
        case .more, .thisMac: MoreView(app: app, session: session)
        }
    }

    /// The board's rows lead to their pages in this window: chosen there, they are chosen in the sidebar.
    private var board: Binding<Route?> {
        Binding(get: { nil }, set: { route in if let route { place = Place(route) } })
    }

    /// The Roundtable is given a task from a device that may (as its board's own button asks), with knights to take it.
    private var mayGive: Bool { session.can("fleet:admin") && !session.rows.isEmpty }

    /// A new chat with Galahad, its message box taking the keys; none while he is answering.
    private var newChat: (() -> Void)? {
        session.chat.answering ? nil : {
            place = .galahad
            session.chat.startNew()
            composerWanted = true
        }
    }

    /// A notification you tapped: its place, and Galahad's chat when it names one.
    private func follow() async {
        guard let opened = PushCenter.shared.opened else { return }
        PushCenter.shared.opened = nil
        switch opened {
        case .inbox: place = .inbox
        case .settings: place = .more
        case .overview: place = .roundtable
        case .chat(let id):
            place = .galahad
            if let id { await session.chat.open(id, with: session.client) }
        }
    }
}

/// What the menus and their keys act on: the window in front (an iPad's windows each have their own place).
struct PlaceActions {
    let go: (Place) -> Void
    /// A new chat with Galahad: none while he is answering.
    let newChat: (() -> Void)?
    /// A task for the Roundtable: none from a device that may not give one, or with no knight to take it.
    let give: (() -> Void)?
}

extension FocusedValues {
    @Entry var placeActions: PlaceActions?
}

/// The menus an iPad shows (its menu bar, and what holding ⌘ lists), as a Mac's: a new chat, a new window and a task for
/// the Roundtable in File, the four places in View, each acting in the window in front.
struct PadCommands: Commands {
    @FocusedValue(\.placeActions) private var actions
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Chat") { actions?.newChat?() }
                .keyboardShortcut("n")
                .disabled(actions?.newChat == nil)
            Button("New Window") { openWindow(id: GalahadApp.main) }
                .keyboardShortcut("n", modifiers: [.command, .option])
            Button("Give the Roundtable a Task…") { actions?.give?() }
                .keyboardShortcut("k")
                .disabled(actions?.give == nil)
        }
        CommandGroup(before: .sidebar) {
            place("Galahad", .galahad, "1")
            place("Roundtable", .roundtable, "2")
            place("Inbox", .inbox, "3")
            place("More", .more, "4")
        }
    }

    private func place(_ name: String, _ place: Place, _ key: KeyEquivalent) -> some View {
        Button(name) { actions?.go(place) }
            .keyboardShortcut(key)
            .disabled(actions == nil)
    }
}

/// A window of its own on an iPad: a chat, a knight or a room (Places.swift), asked again every few seconds while it is
/// in front, as the main window is.
struct PlaceWindowRoot: View {
    let app: AppModel
    let window: PlaceWindow?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch app.phase {
            case .paired(let session):
                if let window {
                    PlaceWindowView(session: session, window: window)
                        .task(id: scenePhase == .active) {
                            guard scenePhase == .active else { return }
                            await app.keepFresh(session)
                        }
                }
            case .loading:
                ProgressView()
            case .unpaired, .broken:
                ContentUnavailableView("Not in a fleet", systemImage: "person.2.slash", description: Text("Join your fleet in Galahad's window first."))
            }
        }
        .tint(.ink)
        .background(WindowTint())
        .task { app.start() }
    }
}

#endif

/// The Keychain couldn't be read: said as exactly that, never taken for "not paired", which would invite pairing over it.
struct KeyUnreadable: View {
    let why: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("This device's key can't be read", systemImage: "key.slash")
        } description: {
            Text(why)
        } actions: {
            Button("Try again", action: retry)
        }
    }
}

/// Where a row of the Roundtable leads: Galahad's chat, or a knight's page.
struct RouteView: View {
    let session: Session
    let route: Route

    var body: some View {
        switch route {
        case .galahad: ChatView(session: session)
        case .knight(let id): KnightView(session: session, id: id)
        case .room(let id): RoomView(session: session, id: id)
        }
    }
}
