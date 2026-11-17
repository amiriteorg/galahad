#if os(macOS)
import SwiftUI

/// The main window once this Mac is paired: the places in a sidebar (Places.swift), This Mac at its foot, and the place
/// chosen beside it; a chat, a knight or a room also opens in a window of its own.
struct MacPlaces: View {
    @Bindable var mac: MacApp
    let session: Session

    var body: some View {
        NavigationSplitView {
            PlacesSidebar(place: $mac.place, session: session) { ThisMacFoot(mac: mac) }
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
        case .roundtable: RoundtableView(session: session, selection: board) { mac.place = Place($0) }
        case .knight(let id): KnightView(session: session, id: id)
        case .room(let id): RoomView(session: session, id: id)
        case .inbox: InboxView(session: session)
        case .more: MoreView(app: mac.app, session: session)
        case .thisMac: GroupedList { ThisMacSections(mac: mac) }.navigationTitle("This Mac")
        }
    }

    /// The board's rows lead to their pages in this window: chosen there, they are chosen in the sidebar.
    private var board: Binding<Route?> {
        Binding(get: { nil }, set: { route in if let route { mac.place = Place(route) } })
    }
}
#endif
