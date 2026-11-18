import SwiftUI

/**
 * The library of hosted MCP servers (the PWA's views/mcp-library.ts): Galahad's reviewed list and the index at
 * mcp.galahad.sh, the official MCP Registry's servers that are their service's own, asked of the node a page at a time
 * (POST /api/connectors/library). Searched by words, narrowed by how it lets Galahad in, its shelf and an order; Add puts
 * one in, and its page (its sign-in or its key) comes next.
 */
struct McpLibraryView: View {
    let session: Session
    @State private var query = ""
    @State private var kind = ""
    @State private var shelf = ""
    @State private var order = "popular"
    @State private var page: LibraryPage?
    @State private var entries: [LibraryEntry] = []
    @State private var problem: String?
    @State private var adding: String?
    /// The server just added: its page, for its sign-in or its key.
    @State private var added: String?
    /// The latest ask: an older, slower answer is dropped.
    @State private var asked = 0

    private struct Filters: Hashable { let query: String; let kind: String; let shelf: String; let order: String }

    var body: some View {
        List {
            if let problem {
                Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege) }
            }
            Section {
                ForEach(entries) { entry in row(entry) }
                if let page, entries.count < page.total {
                    Button("Show more") { Task { await load(more: true) } }
                }
            } footer: {
                if let page { Text(Connectors.libraryLine(page, shown: entries.count)) }
            }
        }
        .navigationTitle("MCP library")
        .searchable(text: $query, prompt: "Search the library")
        .toolbar {
            ToolbarItem(placement: .barTrailing) {
                Menu {
                    Picker("How it lets Galahad in", selection: $kind) {
                        Text("All").tag("")
                        Text("Signs in").tag("oauth")
                        Text("Takes a key").tag("key")
                        Text("Open").tag("none")
                    }
                    Picker("Shelf", selection: $shelf) {
                        Text("Every shelf").tag("")
                        ForEach(page?.categories ?? [], id: \.name) { shelf in Text("\(shelf.name) (\(shelf.count))").tag(shelf.name) }
                    }
                    Picker("Order", selection: $order) {
                        Text("Popular").tag("popular")
                        Text("A–Z").tag("name")
                        Text("Recently updated").tag("updated")
                    }
                } label: {
                    Label("Filter", systemImage: kind.isEmpty && shelf.isEmpty && order == "popular" ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
            }
        }
        .overlay { if page == nil, problem == nil { ProgressView() } }
        .task(id: Filters(query: query, kind: kind, shelf: shelf, order: order)) {
            // Typing settles a moment before the node is asked.
            if page != nil { try? await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled else { return }
            await load(more: false)
            // The index's first read on this node is under way: asked again in a moment, once.
            if let index = page?.index, index.url != nil, index.fetched == nil, index.problem == nil {
                try? await Task.sleep(for: .seconds(2.5))
                if !Task.isCancelled { await load(more: false) }
            }
        }
        .navigationDestination(item: $added) { id in
            ConnectorDetail(session: session, id: id) { await load(more: false) }
        }
    }

    private func row(_ entry: LibraryEntry) -> some View {
        HStack(alignment: .center, spacing: Space.s2) {
            VStack(alignment: .leading, spacing: Space.line) {
                HStack(spacing: Space.s1) {
                    Text(entry.label).font(.headline).lineLimit(1)
                    if entry.reviewed == true { StateBadge(text: "Reviewed", tone: "accent") }
                    if entry.installed { StateBadge(text: "Installed", tone: "ok") }
                }
                Text("\(Connectors.how(entry.auth)) · \(entry.category) · \(URL(string: entry.url)?.host() ?? entry.site)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !entry.description.isEmpty {
                    Text(entry.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: Space.s2)
            if !entry.installed, session.can("brain:write") {
                Button {
                    Task { await add(entry) }
                } label: {
                    if adding == entry.id { ProgressView() } else { Text("Add") }
                }
                .buttonStyle(.bordered)
                .disabled(adding != nil)
            }
        }
        .padding(.vertical, Space.s1)
        .accessibilityElement(children: .combine)
    }

    private func load(more: Bool) async {
        asked += 1
        let mine = asked
        struct Ask: Encodable { let q: String?; let auth: String?; let category: String?; let sort: String; let offset: Int; let limit: Int }
        let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let ask = Ask(q: words.isEmpty ? nil : words, auth: kind.isEmpty ? nil : kind, category: shelf.isEmpty ? nil : shelf, sort: order, offset: more ? entries.count : 0, limit: 30)
        do {
            let answer = try await session.client.post("/api/connectors/library", ask, as: LibraryPage.self)
            guard mine == asked else { return }
            page = answer
            entries = more ? entries + answer.entries : answer.entries
            problem = nil
        } catch {
            if mine == asked { problem = "The library couldn't be read: \(error.localizedDescription)" }
        }
    }

    private func add(_ entry: LibraryEntry) async {
        struct Add: Encodable { let id: String }
        adding = entry.id
        defer { adding = nil }
        do {
            _ = try await session.client.post("/api/connectors", Add(id: entry.id), as: JSONValue.self)
            await load(more: false)
            // Its page next: the sign-in, or the key, or its tools.
            added = entry.id
        } catch {
            problem = "\(entry.label) couldn't be added: \(error.localizedDescription)"
        }
    }
}

/// A server of the library, as the node lists it (core McpLibraryView).
struct LibraryEntry: Decodable, Identifiable, Sendable {
    let id: String
    let label: String
    let description: String
    let url: String
    let site: String
    let category: String
    /// oauth · key · none
    let auth: String
    let rank: Int?
    let reviewed: Bool?
    let installed: Bool
}

/// A page of the library (core ConnectorLibraryView).
struct LibraryPage: Decodable, Sendable {
    struct Shelf: Decodable, Sendable { let name: String; let count: Int }
    struct Index: Decodable, Sendable { let url: String?; let fetched: Double?; let count: Int; let problem: String? }
    let entries: [LibraryEntry]
    let total: Int
    let categories: [Shelf]
    let index: Index
}
