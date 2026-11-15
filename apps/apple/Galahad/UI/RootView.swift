import SwiftUI

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
                ContentUnavailableView {
                    Label("This device's key can't be read", systemImage: "key.slash")
                } description: {
                    Text(why)
                } actions: {
                    Button("Try again") { app.start() }
                }
            }
        }
        .tint(.ink)
        .task { app.start() }
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

    var body: some View {
        TabView {
            Tab("Roundtable", systemImage: "person.3") {
                NavigationStack {
                    RoundtableView(session: session)
                        .navigationDestination(for: Route.self) { RouteView(session: session, route: $0) }
                }
            }
            Tab("Inbox", systemImage: "tray") {
                NavigationStack { InboxView(session: session) }
            }
            .badge(session.inboxCount)
            Tab("More", systemImage: "ellipsis.circle") {
                NavigationStack { MoreView(app: app, session: session) }
            }
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
            case .roundtable: RoundtableView(session: session, selection: $route)
            case .inbox: InboxView(session: session)
            case .more: MoreView(app: app, session: session)
            }
        } detail: {
            NavigationStack { RouteView(session: session, route: route ?? .galahad) }
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
        }
    }
}
