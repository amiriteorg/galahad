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
        .task { app.start() }
    }
}

/// The paired app: the Roundtable and the Inbox, asked again every few seconds while the app is open.
struct MainView: View {
    let app: AppModel
    let session: Session
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            Tab("Roundtable", systemImage: "person.3") {
                NavigationStack { RoundtableView(session: session) }
            }
            Tab("Inbox", systemImage: "tray") {
                NavigationStack { InboxView(session: session) }
            }
            .badge(session.inboxCount)
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
