import Observation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// What each picture of yours looks like, by its id: those sent from here are known already; another is asked of the
/// node once (`POST /api/uploads/get`). Kept while the app runs, never on disk.
@MainActor @Observable final class AttachmentLooks {
    static let shared = AttachmentLooks()

    private var known: [String: Data] = [:]
    private var asking: Set<String> = []

    func know(_ id: String, _ data: Data) {
        known[id] = data
    }

    func data(_ id: String) -> Data? {
        known[id]
    }

    /// Asks the node for a picture's bytes, once; what is there afterwards is `data(_:)`.
    func load(_ ref: AttachmentRef, with client: NodeClient) async {
        guard ref.isPicture, known[ref.id] == nil, !asking.contains(ref.id) else { return }
        asking.insert(ref.id)
        defer { asking.remove(ref.id) }
        struct Asked: Encodable { let id: String }
        if let data = try? await client.bytes("/api/uploads/get", Asked(id: ref.id)) { known[ref.id] = data }
    }
}

/// What a message of yours carried: its pictures (each opened large with a tap) and its texts, by name and size.
struct AttachedView: View {
    let refs: [AttachmentRef]
    let client: NodeClient?
    @State private var opened: AttachmentRef?

    var body: some View {
        let looks = AttachmentLooks.shared
        HStack(spacing: Space.s2) {
            Spacer(minLength: 0)
            ForEach(refs, id: \.id) { ref in
                if ref.isPicture {
                    Button {
                        opened = ref
                    } label: {
                        Group {
                            if let data = looks.data(ref.id), let image = PlatformImage(data: data) {
                                Image(platformImage: image).resizable().scaledToFill()
                            } else {
                                Rectangle().fill(.fill.tertiary).overlay { ProgressView().controlSize(.small) }
                            }
                        }
                        .frame(width: 132, height: 132)
                        .clipShape(.rect(cornerRadius: Metrics.cardRadius, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(ref.name)")
                    .task { if let client { await looks.load(ref, with: client) } }
                } else {
                    FileChip(name: ref.name, said: Self.size(ref.bytes))
                }
            }
        }
        .sheet(item: $opened) { ref in
            NavigationStack {
                Group {
                    if let data = looks.data(ref.id), let image = PlatformImage(data: data) {
                        Image(platformImage: image).resizable().scaledToFit().padding()
                    } else {
                        ProgressView()
                    }
                }
                .navigationTitle(ref.name)
                .inlineTitle()
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { opened = nil } } }
            }
            #if os(macOS)
            .frame(minWidth: 520, minHeight: 420)
            #endif
        }
    }

    /// A size as the app says one: bytes, KB or MB.
    static func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

extension AttachmentRef: Identifiable {}

/// A text file, by its name and what is said of it (its size, or that it is going up).
struct FileChip: View {
    let name: String
    let said: String
    var failed = false

    var body: some View {
        HStack(spacing: Space.s2) {
            Image(systemName: failed ? "exclamationmark.triangle" : "doc.text").foregroundStyle(failed ? Color.siege : .secondary)
            VStack(alignment: .leading, spacing: 0) {
                Text(name).font(.callout).lineLimit(1)
                Text(said).font(.caption).foregroundStyle(failed ? Color.siege : .secondary).lineLimit(1)
            }
        }
        .padding(.horizontal, Space.s3)
        .padding(.vertical, Space.s2)
        .background(.fill.tertiary, in: .rect(cornerRadius: Metrics.innerRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Your next message's files, above its words: each as it looks (a picture) or by name, going up or up, to remove.
struct WaitingFiles: View {
    let chat: ChatModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s2) {
                ForEach(chat.waiting) { file in
                    HStack(spacing: Space.s2) {
                        ZStack {
                            if let data = file.look, let image = PlatformImage(data: data) {
                                Image(platformImage: image).resizable().scaledToFill().frame(width: 36, height: 36).clipShape(.rect(cornerRadius: 7, style: .continuous))
                            } else {
                                Image(systemName: failed(file) == nil ? "doc.text" : "exclamationmark.triangle").frame(width: 36, height: 36).foregroundStyle(.secondary)
                            }
                            if file.state == .going { ProgressView().controlSize(.small) }
                        }
                        VStack(alignment: .leading, spacing: 0) {
                            Text(file.name).font(.callout).lineLimit(1)
                            Text(failed(file) ?? (file.state == .going ? "Sending…" : AttachedView.size(file.size)))
                                .font(.caption)
                                .foregroundStyle(failed(file) == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.siege))
                                .lineLimit(1)
                        }
                        .frame(maxWidth: 140, alignment: .leading)
                        Button {
                            chat.detach(file.id)
                        } label: {
                            Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 24, height: 24)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Remove \(file.name)")
                    }
                    .padding(Space.s1)
                    .padding(.trailing, Space.s1)
                    .background(.fill.tertiary, in: .rect(cornerRadius: Metrics.innerRadius, style: .continuous))
                    .accessibilityElement(children: .contain)
                }
            }
        }
        .accessibilityLabel("Files with your message")
    }

    private func failed(_ file: ChatModel.Waiting) -> String? {
        if case .failed(let why) = file.state { why } else { nil }
    }
}

/// Files for your next message: a photo from Photos, or a file (a picture, or text) from Files.
struct AttachButton: View {
    let chat: ChatModel
    let client: NodeClient
    @State private var photos: [PhotosPickerItem] = []
    @State private var choosingPhotos = false
    @State private var choosingFiles = false

    /// What Files offers: pictures, and the kinds of text one attaches (logs, notes, code, data).
    static let kinds: [UTType] = [.image, .text, .plainText, .sourceCode, .json, .xml, .yaml, .commaSeparatedText, .log]

    var body: some View {
        Menu {
            Button { choosingPhotos = true } label: { Label("Photos", systemImage: "photo.on.rectangle") }
            Button { choosingFiles = true } label: { Label("Files", systemImage: "folder") }
        } label: {
            Image(systemName: "paperclip").font(.body.weight(.semibold)).frame(width: 30, height: 30)
        }
        .menuIndicator(.hidden)
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .disabled(chat.waiting.count >= Attachments.perMessage)
        .accessibilityLabel("Attach pictures or files")
        .accessibilityIdentifier("attach")
        .photosPicker(isPresented: $choosingPhotos, selection: $photos, maxSelectionCount: Attachments.perMessage - chat.waiting.count, matching: .images)
        .onChange(of: photos) { _, chosen in
            guard !chosen.isEmpty else { return }
            photos = []
            Task {
                var files: [(name: String, data: Data)] = []
                for (n, item) in chosen.enumerated() {
                    if let data = try? await item.loadTransferable(type: Data.self) { files.append((name: chosen.count == 1 ? "Photo" : "Photo \(n + 1)", data: data)) }
                }
                chat.attach(files, with: client)
            }
        }
        .fileImporter(isPresented: $choosingFiles, allowedContentTypes: Self.kinds, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            chat.attach(Self.read(urls, refused: { chat.attachProblem = $0 }), with: client)
        }
    }

    /// The most a file may be to be read at all: a photo that large is still drawn again small enough to go.
    static let readLimit = 64 * 1024 * 1024

    /// Files from Files (or dropped), read whole while this app may; one past `readLimit`, or unreadable, is said so.
    static func read(_ urls: [URL], refused: (String) -> Void) -> [(name: String, data: Data)] {
        urls.compactMap { url in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > readLimit {
                refused("\(url.lastPathComponent) is too big to go with a message.")
                return nil
            }
            guard let data = try? Data(contentsOf: url) else {
                refused("\(url.lastPathComponent) couldn't be read.")
                return nil
            }
            return (name: url.lastPathComponent, data: data)
        }
    }
}
