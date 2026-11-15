import SwiftUI

/**
 * A knight's screen, watched and taken over (the PWA's desktop viewer): a picture of its desktop, asked for about every
 * two seconds while it is on screen and the app is in front, and what you do there. A tap on the picture clicks at that
 * place on the knight's screen; text is typed (and never written to the ledger); a key, an address and scrolling are one
 * press each. Each thing done brings back the screen as it then is.
 */
struct KnightScreenView: View {
    let session: Session
    let knight: Teammate
    @State private var shot: DesktopShot?
    @State private var picture: UIImage?
    @State private var status = "Looking…"
    @State private var problem: String?
    @State private var noDesktop = false
    @State private var sending = false
    /// What was asked last: each look or thing done waits for the one before it, so none is dropped.
    @State private var queue: Task<Void, Never>?
    @State private var address = ""
    @State private var typed = ""
    @State private var hidden = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                screen
                Text(status).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                if noDesktop {
                    Label("\(knight.name)'s VM has no desktop just now. Make it again with a desktop from a terminal or the PWA: its work in /work stays.", systemImage: "display.trianglebadge.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(Color.siege)
                } else if let problem {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(problem, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Color.siege)
                        Button("Try again") { Task { await act(nil) } }.buttonStyle(.bordered).controlSize(.small)
                    }
                }
                controls
            }
            .padding()
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("\(knight.name)'s screen")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        // Asked again while you're watching, and only then.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                if problem == nil, !noDesktop, !sending { await act(nil) }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private var screen: some View {
        GeometryReader { box in
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.black.opacity(0.85))
                if let picture {
                    Image(uiImage: picture)
                        .resizable()
                        .interpolation(.medium)
                        .scaledToFit()
                        .accessibilityLabel("\(knight.name)'s screen")
                        .accessibilityHint("A tap clicks at that place on it")
                } else {
                    ProgressView().tint(.white)
                }
            }
            .clipShape(.rect(cornerRadius: 12, style: .continuous))
            .contentShape(.rect)
            .onTapGesture(coordinateSpace: .local) { location in
                guard let shot else { return }
                // The picture is drawn to fit the box: the tap is read against where it is drawn.
                let drawn = fitted(width: shot.width, height: shot.height, in: box.size)
                if let point = Desktop.point(tap: location, shown: drawn, screen: (shot.width, shot.height)) {
                    Task { await act(.click(x: point.x, y: point.y)) }
                }
            }
        }
        .aspectRatio(CGFloat(shot?.width ?? 16) / CGFloat(shot?.height ?? 10), contentMode: .fit)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TextField("An address to open", text: $address)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.go)
                    .onSubmit(open)
                Button("Open", action: open).buttonStyle(.bordered).disabled(Desktop.address(address) == nil)
            }
            HStack(spacing: 8) {
                Group {
                    if hidden {
                        SecureField("Text to type on \(knight.name)'s screen", text: $typed)
                    } else {
                        TextField("Text to type on \(knight.name)'s screen", text: $typed)
                    }
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .onSubmit(type)
                Button("Type", action: type).buttonStyle(.bordered).disabled(typed.isEmpty)
            }
            Toggle("Hide what I type", isOn: $hidden).font(.footnote)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Desktop.keys, id: \.key) { each in
                        Button(each.label) { Task { await act(.key(each.key)) } }.buttonStyle(.bordered).controlSize(.small)
                    }
                    Button { Task { await act(.scroll(up: true, times: 3)) } } label: { Label("Scroll up", systemImage: "arrow.up") }
                        .buttonStyle(.bordered).controlSize(.small)
                    Button { Task { await act(.scroll(up: false, times: 3)) } } label: { Label("Scroll down", systemImage: "arrow.down") }
                        .buttonStyle(.bordered).controlSize(.small)
                }
            }
            .disabled(shot == nil)
            Text("What you type goes to \(knight.name)'s screen and nowhere else: it isn't kept here, and the ledger says only that something was typed.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func open() {
        guard let where_ = Desktop.address(address) else { return }
        Task { await act(.open(where_)) }
    }

    private func type() {
        let text = typed
        typed = ""
        guard !text.isEmpty else { return }
        Task { await act(.type(text)) }
    }

    /// One look, or one thing done and then the screen as it is: in turn, never two at once, and never dropped.
    private func act(_ action: DesktopAction?) async {
        let before = queue
        let turn = Task { @MainActor in
            await before?.value
            await send(action)
        }
        queue = turn
        await turn.value
    }

    private func send(_ action: DesktopAction?) async {
        sending = true
        defer { sending = false }
        if action != nil { status = "Sending…" }
        struct Ask: Encodable { let id: String; let action: DesktopAction? }
        do {
            let next = try await session.client.post("/api/team/desktop", Ask(id: knight.id, action: action), as: DesktopShot.self)
            guard let data = Desktop.picture(next), let image = UIImage(data: data) else {
                problem = "The desktop sent a picture this app doesn't show."
                return
            }
            (shot, picture, problem, noDesktop) = (next, image, nil, false)
            status = "Seen just now · \(next.width)×\(next.height)"
        } catch {
            // Nothing more is asked until you ask: a refusal is said once, not every two seconds.
            if Desktop.saysNoDesktop(error) { noDesktop = true } else { problem = error.localizedDescription }
            status = shot == nil ? "Not seen" : "As it was last seen"
        }
    }

    /// Where a picture of this size is drawn when fitted into the box.
    private func fitted(width: Int, height: Int, in size: CGSize) -> CGRect {
        let scale = min(size.width / CGFloat(width), size.height / CGFloat(height))
        let drawn = CGSize(width: CGFloat(width) * scale, height: CGFloat(height) * scale)
        return CGRect(origin: CGPoint(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2), size: drawn)
    }
}
