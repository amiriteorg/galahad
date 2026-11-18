import SwiftUI

/// A knight's workspace (its VM's /work, or Galahad's computer's), read: its files to browse and open, and what its
/// task changed (`POST /api/team/files`, `/file`, `/changes`; the terminal's `galahad roundtable files|read|changes`).
/// Beside its conversation on an iPad or a Mac (an inspector), a sheet on an iPhone. Nothing here writes to it.
struct WorkspaceView: View {
    let session: Session
    let id: String
    let name: String
    @State private var shown: Shown = .files
    @Environment(\.dismiss) private var dismiss

    enum Shown: String, CaseIterable { case files = "Files", changes = "Changes" }

    var body: some View {
        NavigationStack {
            Group {
                switch shown {
                case .files: FolderView(session: session, id: id, path: "/work")
                case .changes: ChangesView(session: session, id: id)
                }
            }
            .navigationDestination(for: WorkspaceItem.self) { item in
                switch item {
                case .folder(let path): FolderView(session: session, id: id, path: path)
                case .file(let path): WorkspaceFile(session: session, id: id, path: path)
                case .diff(let title, let text): CodeLines(text: text, lang: "diff").navigationTitle(title).inlineTitle()
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Show", selection: $shown) {
                        ForEach(Shown.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                    .accessibilityLabel("\(name)'s workspace")
                }
                #if os(iOS)
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                #endif
            }
        }
    }
}

extension View {
    /// A workspace beside what it belongs to: a column of its own on an iPad or a Mac (an inspector), a sheet on an
    /// iPhone (where an inspector in a pushed page kept the page from being pushed at all, seen on iOS 27).
    func workspacePanel<Panel: View>(isPresented: Binding<Bool>, @ViewBuilder panel: @escaping () -> Panel) -> some View {
        modifier(WorkspacePanel(isPresented: isPresented, panel: panel))
    }
}

private struct WorkspacePanel<Panel: View>: ViewModifier {
    @Binding var isPresented: Bool
    let panel: () -> Panel
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var width
    #endif

    func body(content: Content) -> some View {
        #if os(iOS)
        if width == .regular {
            content.inspector(isPresented: $isPresented) { panel().inspectorColumnWidth(min: 320, ideal: 440, max: 720) }
        } else {
            content.sheet(isPresented: $isPresented) { panel() }
        }
        #else
        content.inspector(isPresented: $isPresented) { panel().inspectorColumnWidth(min: 320, ideal: 440, max: 720) }
        #endif
    }
}

/// Where a workspace's pages go: a folder, a file, or a diff (one file's part, or all of it).
enum WorkspaceItem: Hashable {
    case folder(String)
    case file(String)
    case diff(title: String, text: String)
}

/// A folder of the workspace: folders first, then files with their sizes; each opens where it is.
private struct FolderView: View {
    let session: Session
    let id: String
    let path: String
    @State private var view: TeamFilesView?
    @State private var problem: String?

    var body: some View {
        List {
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege)
            }
            if let view {
                ForEach(view.entries, id: \.name) { entry in
                    let full = path == "/work" ? "/work/\(entry.name)" : "\(path)/\(entry.name)"
                    NavigationLink(value: entry.kind == "dir" ? WorkspaceItem.folder(full) : WorkspaceItem.file(full)) {
                        HStack(spacing: Space.s3) {
                            Image(systemName: entry.kind == "dir" ? "folder.fill" : entry.kind == "link" ? "arrowshape.turn.up.right" : "doc.text")
                                .foregroundStyle(entry.kind == "dir" ? AnyShapeStyle(Color.ink) : AnyShapeStyle(.secondary))
                                .frame(width: 22)
                            Text(entry.name).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: Space.s2)
                            if entry.kind == "file" {
                                Text(AttachedView.size(entry.size)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(entry.kind == "other")
                }
                if view.more {
                    Text("Only its first \(view.entries.count) entries are listed.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .overlay {
            if let view, view.entries.isEmpty, problem == nil {
                ContentUnavailableView("Nothing here yet", systemImage: "folder", description: Text("\(path) is empty."))
            } else if view == nil, problem == nil {
                ProgressView()
            }
        }
        .navigationTitle(path == "/work" ? "Workspace" : String(path.split(separator: "/").last ?? "Folder"))
        .inlineTitle()
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        struct Ask: Encodable { let id: String; let path: String }
        do {
            view = try await session.client.post("/api/team/files", Ask(id: id, path: path), as: TeamFilesView.self)
            problem = nil
        } catch {
            problem = "This folder couldn't be read: \(error.localizedDescription)"
        }
    }
}

/// One file of the workspace: code coloured with its lines numbered, Markdown drawn (or its source), a picture, or what
/// it is when it is neither.
private struct WorkspaceFile: View {
    let session: Session
    let id: String
    let path: String
    @State private var file: TeamFileView?
    @State private var problem: String?
    @State private var source = false
    @AppStorage("code.wrap") private var wrap = false

    private var name: String { String(path.split(separator: "/").last ?? "File") }
    private var markdown: Bool { name.lowercased().hasSuffix(".md") || name.lowercased().hasSuffix(".markdown") }

    var body: some View {
        Group {
            if let file {
                switch file.kind {
                case "text":
                    if markdown, !source {
                        ScrollView { MarkdownView(file.text ?? "").frame(maxWidth: .infinity, alignment: .leading).padding(Space.s4) }
                    } else {
                        CodeLines(text: file.text ?? "", lang: DiffParts.language(of: path), wrap: wrap)
                    }
                case "image":
                    if let data = file.data.flatMap({ Data(base64Encoded: $0) }), let image = PlatformImage(data: data) {
                        ScrollView([.vertical, .horizontal]) { Image(platformImage: image).resizable().scaledToFit().frame(maxWidth: 1200) }
                    } else {
                        ContentUnavailableView("This picture couldn't be drawn", systemImage: "photo")
                    }
                case "large":
                    ContentUnavailableView("Too big to show here", systemImage: "photo", description: Text("A picture of \(AttachedView.size(file.size)). Open it in its terminal, or keep it as an artifact."))
                default:
                    ContentUnavailableView("Not text", systemImage: "doc", description: Text("\(AttachedView.size(file.size)) that isn't text or a picture this app shows."))
                }
            } else if let problem {
                ContentUnavailableView("It couldn't be read", systemImage: "exclamationmark.triangle", description: Text(problem))
            } else {
                ProgressView()
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let file, file.cut == true || file.redacted == true {
                Label(file.cut == true ? "Only its beginning is here: it is \(AttachedView.size(file.size))." : "Something that looked like a key was redacted.", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(Space.s2)
                    .frame(maxWidth: .infinity)
                    .background(.bar)
            }
        }
        .navigationTitle(name)
        .inlineTitle()
        .toolbar {
            if let text = file?.text {
                ToolbarItemGroup(placement: .primaryAction) {
                    if markdown {
                        Toggle(isOn: $source) { Label("Source", systemImage: "chevron.left.forwardslash.chevron.right") }
                    } else {
                        Toggle(isOn: $wrap) { Label("Wrap Lines", systemImage: "text.word.spacing") }
                    }
                    ShareLink(item: text) { Label("Share", systemImage: "square.and.arrow.up") }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        struct Ask: Encodable { let id: String; let path: String }
        do {
            file = try await session.client.post("/api/team/file", Ask(id: id, path: path), as: TeamFileView.self)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// What the knight's latest task changed (or its repository, with none): each file with its lines added and removed,
/// opening its part of the diff, and the whole diff.
private struct ChangesView: View {
    let session: Session
    let id: String
    @State private var changes: TeamChangesView?
    @State private var problem: String?

    var body: some View {
        List {
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.siege)
            }
            if let changes {
                let parts = DiffParts.of(changes.diff)
                Section {
                    ForEach(changes.files, id: \.self) { file in
                        let part = parts.first { $0.path == file.path }
                        NavigationLink(value: WorkspaceItem.diff(title: file.path, text: part?.text ?? "")) {
                            HStack(spacing: Space.s3) {
                                Text(file.status)
                                    .font(.caption.monospaced().weight(.bold))
                                    .foregroundStyle(file.status == "A" ? Highlight.Tone.added.color : file.status == "D" ? Highlight.Tone.removed.color : .secondary)
                                    .frame(width: 16)
                                Text(file.path).font(.callout.monospaced()).lineLimit(1).truncationMode(.head)
                                Spacer(minLength: Space.s2)
                                if let added = file.added, let removed = file.removed {
                                    Text("+\(added)").foregroundStyle(Highlight.Tone.added.color)
                                    Text("−\(removed)").foregroundStyle(Highlight.Tone.removed.color)
                                } else {
                                    Text("binary").foregroundStyle(.secondary)
                                }
                            }
                            .font(.caption.monospacedDigit())
                        }
                        .disabled(part == nil)
                    }
                    ForEach(changes.untracked, id: \.self) { file in
                        HStack(spacing: Space.s3) {
                            Text("?").font(.caption.monospaced().weight(.bold)).foregroundStyle(.secondary).frame(width: 16)
                            Text(file).font(.callout.monospaced()).lineLimit(1).truncationMode(.head)
                        }
                        .accessibilityLabel("\(file), not tracked yet")
                    }
                } header: {
                    Text(heading(changes))
                } footer: {
                    if changes.files.isEmpty, changes.untracked.isEmpty { Text("Nothing changed yet.") }
                    else if changes.cut { Text("The diff is cut: only its beginning is here.") }
                    else if changes.redacted == true { Text("Something that looked like a key was redacted.") }
                }
                if !changes.diff.isEmpty {
                    NavigationLink(value: WorkspaceItem.diff(title: "The whole diff", text: changes.diff)) {
                        Label("The whole diff", systemImage: "doc.plaintext")
                    }
                }
            }
        }
        .overlay { if changes == nil, problem == nil { ProgressView() } }
        .navigationTitle("Changes")
        .inlineTitle()
        .refreshable { await load() }
        .task { await load() }
    }

    private func heading(_ changes: TeamChangesView) -> String {
        let from = changes.base.map { "from \($0.prefix(8))" } ?? "since its last commit"
        return changes.task == nil ? "Its repository, \(from)" : "Its latest task, \(from)"
    }

    private func load() async {
        struct Ask: Encodable { let id: String }
        do {
            changes = try await session.client.post("/api/team/changes", Ask(id: id), as: TeamChangesView.self)
            problem = nil
        } catch {
            problem = "Its changes couldn't be read: \(error.localizedDescription)"
        }
    }
}
