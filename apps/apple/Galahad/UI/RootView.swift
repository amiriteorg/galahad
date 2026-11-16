import SwiftUI

#if os(iOS)
/// Pairing until this device is in the fleet; the app itself after.
struct RootView: View {
    @State private var app = AppModel()

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

/// The paired app, asked again every few seconds while it is open. On an iPhone, three tabs; on an iPad (a regular
/// width), a split view: the places in the sidebar, the place's list beside them, and Galahad's chat, or the knight you
/// chose, in the rest, so he stays at hand whatever else is open.
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
            while !Task.isCancelled {
                await session.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

/// The app's places.
enum Place: Hashable {
    case roundtable, inbox, more
}

struct PhoneTabs: View {
    let app: AppModel
    let session: Session
    @State private var place: Place = .roundtable
    @State private var path: [Route] = []

    var body: some View {
        TabView(selection: $place) {
            Tab("Roundtable", systemImage: "person.3", value: Place.roundtable) {
                NavigationStack(path: $path) {
                    RoundtableView(session: session) { path.append($0) }
                        .navigationDestination(for: Route.self) { RouteView(session: session, route: $0) }
                }
            }
            Tab("Inbox", systemImage: "tray", value: Place.inbox) {
                NavigationStack { InboxView(session: session) }
            }
            .badge(session.inboxCount)
            Tab("More", systemImage: "ellipsis.circle", value: Place.more) {
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
        case .inbox: place = .inbox
        case .settings: place = .more
        case .overview: place = .roundtable; path = []
        case .chat(let id):
            place = .roundtable
            path = [.galahad]
            if let id { await session.chat.open(id, with: session.client) }
        }
    }
}

struct SplitPlaces: View {
    let app: AppModel
    let session: Session
    @State private var place: Place? = .roundtable
    @State private var route: Route? = .galahad

    var body: some View {
        NavigationSplitView {
            List(selection: $place) {
                Label("Roundtable", systemImage: "person.3").tag(Place.roundtable)
                Label("Inbox", systemImage: "tray").badge(session.inboxCount).tag(Place.inbox)
                Label("More", systemImage: "ellipsis.circle").tag(Place.more)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { RoundtableMark(size: 28) }
                    .sharedBackgroundVisibility(.hidden)
            }
        } content: {
            switch place ?? .roundtable {
            case .roundtable: RoundtableView(session: session, selection: $route) { route = $0 }
            case .inbox: InboxView(session: session)
            case .more: MoreView(app: app, session: session)
            }
        } detail: {
            NavigationStack { RouteView(session: session, route: route ?? .galahad) }
        }
        .task(id: PushCenter.shared.opened) { await follow() }
    }

    /// A notification you tapped: its place in the sidebar, and Galahad's chat beside when it names one.
    private func follow() async {
        guard let opened = PushCenter.shared.opened else { return }
        PushCenter.shared.opened = nil
        switch opened {
        case .inbox: place = .inbox
        case .settings: place = .more
        case .overview: place = .roundtable
        case .chat(let id):
            place = .roundtable
            route = .galahad
            if let id { await session.chat.open(id, with: session.client) }
        }
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
