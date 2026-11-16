#if os(macOS)
import AppKit
import SwiftUI

/// The first run, on a Mac with no node: one window, three steps down its side as an installer's are (docs/MAC.md, "The
/// screens"). Make this Mac a node (start a fleet, join yours, or just the app); keep it on (a Mac with a battery skips
/// it: it works while it's open); give its knights VMs.
struct FirstRunView: View {
    let mac: MacApp
    @Bindable var run: FirstRun
    var setup = NodeSetup { _ in }

    var body: some View {
        HStack(spacing: 0) {
            FirstRunSteps(current: run.step)
                .frame(width: 236)
            Divider()
            VStack(spacing: 0) {
                Form {
                    switch run.step {
                    case .node: nodeStep
                    case .stayOn: stayOnStep
                    case .vms: vmsStep
                    }
                }
                .formStyle(.grouped)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                Divider()
                footer
            }
        }
        .task(id: run.step) {
            // Staying on is read again every few seconds while it is shown, as you change what it reads.
            guard run.step == .stayOn else { return }
            while !Task.isCancelled {
                await mac.thisMac.refresh()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    // MARK: 1. Make this Mac a node

    @ViewBuilder private var nodeStep: some View {
        Section {
            StepHead(title: FirstRun.Step.node.title, line: "A node is where Galahad and his knights do their work. This Mac can be one, run by this app whenever the Mac is on, or it can be your client alone.")
        }
        .listRowBackground(Color.clear)
        if run.way != .client, let unready = setup.unready {
            Section {
                Label(unready, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                if setup.bundle.carriesNode {
                    Text("Drag Galahad into Applications, then open it from there.").foregroundStyle(.secondary)
                    Button("Show the Applications Folder") { NSWorkspace.shared.open(URL(filePath: "/Applications")) }
                }
            }
        }
        Section {
            FormField("Name", text: $run.name)
                .disabled(run.working)
        } header: {
            Text("Its name")
        } footer: {
            Text("How this Mac appears in your fleet.")
        }
        Section {
            WayRow(title: "Start a fleet", detail: "This Mac is your fleet's first node, its keys and its memory kept here.", chosen: run.way == .start) { run.way = .start }
            if run.way == .start {
                FormField("The fleet's name", text: $run.fleet).disabled(run.working)
            }
            WayRow(title: "Join my fleet", detail: "Another node of yours invites it: run galahad invite there. You approve it there once the two codes match.", chosen: run.way == .join) { run.way = .join }
            if run.way == .join {
                FormField("Paste the invite (gi1.…)", text: $run.invite, axis: .vertical)
                    .lineLimit(2...4)
                    .font(.footnote.monospaced())
                    .autocorrectionDisabled()
                    .disabled(run.working)
            }
            WayRow(title: "Just the app", detail: "Your client alone, paired with a node elsewhere. This Mac can still become a node later, from This Mac.", chosen: run.way == .client) { run.way = .client }
        } header: {
            Text("This Mac will")
        }
        .disabled(run.working)
        progress
    }

    // MARK: 2. Keep it on

    @ViewBuilder private var stayOnStep: some View {
        Section {
            StepHead(title: FirstRun.Step.stayOn.title, line: "A node is only useful while it's up. Each line is read from this Mac as it is now: a tick, or what is missing. Galahad never changes these settings itself; each button opens the place that does.")
        }
        .listRowBackground(Color.clear)
        if let stayingOn = mac.thisMac.stayingOn {
            Section {
                ForEach(stayingOn.lines) { line in
                    StayingOnRow(line: line) { StayingOnAction(line: line, node: mac.thisMac) }
                }
            } footer: {
                Text("You can come back to these in Settings → This Mac.")
            }
        } else {
            Section { ProgressView().frame(maxWidth: .infinity) }
        }
        progress
    }

    // MARK: 3. Give its knights VMs

    @ViewBuilder private var vmsStep: some View {
        Section {
            StepHead(title: FirstRun.Step.vms.title, line: "Each knight works in a VM of its own. On a Mac they are made with Apple's container, which runs each one in a lightweight VM on this Mac's own silicon.")
        }
        .listRowBackground(Color.clear)
        Section {
            ContainerLine()
            Text("This release of Galahad doesn't make knights' VMs on a Mac yet: an update brings them. Until then, knights work on your other nodes.")
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Shared

    /// What it is doing now, the code to compare while joining, and what went wrong.
    @ViewBuilder private var progress: some View {
        if let stage = run.stage {
            Section {
                if case .joining(let code?) = stage {
                    VStack(spacing: Space.s3) {
                        Text("Your code").font(.subheadline).foregroundStyle(.secondary)
                        Text(code)
                            .font(.system(size: 46, weight: .semibold, design: .monospaced))
                            .accessibilityLabel(code.map(String.init).joined(separator: " "))
                        Text("Approve \(Text(run.name).bold()) on the node that invited it, only if that node shows this exact code.")
                            .font(.callout)
                            .multilineTextAlignment(.center)
                        HStack(spacing: Space.s2) {
                            ProgressView().controlSize(.small)
                            Text("Waiting for your approval…")
                        }
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Space.s2)
                } else {
                    HStack(spacing: Space.s2) {
                        ProgressView().controlSize(.small)
                        Text(stage.words)
                    }
                    if stage == .approving {
                        Button("Open Login Items") { mac.thisMac.agent.openLoginItems() }
                    }
                }
            }
        }
        if let problem = run.problem {
            Section {
                Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
        }
    }

    private var footer: some View {
        HStack(spacing: Space.s3) {
            if run.working {
                Button("Cancel") { run.cancel() }
                    .disabled(run.step != .node)
            }
            Spacer()
            Button {
                switch run.step {
                case .node: run.go(app: mac.app)
                case .stayOn, .vms: run.next()
                }
            } label: {
                Text(primary)
                    .fontWeight(.semibold)
                    .foregroundStyle(Prominent.label(dimmed: !canContinue))
                    .padding(.horizontal, Space.s2)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .disabled(!canContinue)
        }
        .padding(.horizontal, Space.s6)
        .padding(.vertical, Space.s4)
    }

    private var primary: String {
        switch run.step {
        case .node: run.way == .start ? "Start the Fleet" : run.way == .join ? "Join the Fleet" : "Continue"
        case .stayOn: "Continue"
        case .vms: "Done"
        }
    }

    private var canContinue: Bool {
        switch run.step {
        case .node: run.canGo && (run.way == .client || setup.unready == nil)
        case .stayOn, .vms: !run.working
        }
    }
}

/// The three steps down the window's side: those done ticked, the one you're on in the ink, those to come in grey.
struct FirstRunSteps: View {
    let current: FirstRun.Step

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            AppTile(size: 56)
                .padding(.bottom, Space.s4)
            ForEach(FirstRun.Step.allCases, id: \.self) { step in
                HStack(spacing: Space.s2) {
                    Image(systemName: step < current ? "checkmark.circle.fill" : step == current ? "\(step.rawValue).circle.fill" : "\(step.rawValue).circle")
                        .font(.title3)
                        .foregroundStyle(step == current ? AnyShapeStyle(Color.ink) : AnyShapeStyle(.secondary))
                    Text(step.title)
                        .fontWeight(step == current ? .semibold : .regular)
                        .foregroundStyle(step > current ? .secondary : .primary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(step == current ? .isSelected : [])
            }
            Spacer()
        }
        .padding(Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// A step's title and what it is for.
private struct StepHead: View {
    let title: String
    let line: String

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            Text(title).font(.largeTitle.bold())
            Text(line).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, Space.s2)
    }
}

/// One of step 1's three ways, chosen as a radio button is.
private struct WayRow: View {
    let title: String
    let detail: String
    let chosen: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(chosen ? AnyShapeStyle(Color.ink) : AnyShapeStyle(.secondary))
                VStack(alignment: .leading, spacing: Space.line) {
                    Text(title).font(.headline)
                    Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// What a line of staying on offers to put it right: the pane of System Settings that changes it, or, for what is the
/// node's own (its service, keeping awake, publishing on your tailnet), the node.
struct StayingOnAction: View {
    let line: StayingOn.Line
    let node: ThisMac

    var body: some View {
        switch line.fix {
        case .loginItems?: Button("Open Login Items") { node.agent.openLoginItems() }
        // A node install.sh made has a service of its own.
        case .runAtLogin? where !node.scripted: Button("Run at Login") { node.runAtLogin() }
        case .usersAndGroups?: Button("Open Users & Groups") { SystemSettings.open(.usersAndGroups) }
        case .fileVault?: Button("Open FileVault") { SystemSettings.open(.privacy) }
        case .keepAwake?: Button("Keep Awake") { node.keepAwake() }.disabled(node.busy != nil)
        case .restart?: Button("Restart the Node") { node.restart() }.disabled(node.busy != nil)
        case .energy?: Button("Open Energy") { SystemSettings.open(.energy) }
        case .publish?: Button("Publish") { node.publish() }.disabled(node.busy != nil)
        case .openTailscale?: Button("Open Tailscale") { NSWorkspace.shared.open(Tailscale.app) }
        case .getTailscale?: Button("Get Tailscale") { NSWorkspace.shared.open(Tailscale.download) }
        case .runAtLogin?, nil: EmptyView()
        }
    }
}

/// Apple's `container` on this Mac: installed (and its version), or not.
private struct ContainerLine: View {
    @State private var version: String?
    @State private var looked = false
    private static let command = URL(filePath: "/usr/local/bin/container")

    var body: some View {
        HStack(spacing: Space.s3) {
            Image(systemName: version != nil ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(version != nil ? AnyShapeStyle(Color.green) : AnyShapeStyle(.secondary))
            VStack(alignment: .leading, spacing: Space.line) {
                Text("Apple's container")
                Text(version ?? (looked ? "Not installed. It comes from Apple's releases on GitHub, and Galahad will offer to install it." : "Looking…"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .task {
            if FileManager.default.isExecutableFile(atPath: Self.command.path), let ran = try? await Command.run(Self.command, ["--version"]), ran.succeeded {
                version = "Installed: \(ran.lastLine)"
            }
            looked = true
        }
    }
}

/// A Mac that is a node already (install.sh made it, or this app was asked to forget its key), and this app isn't paired:
/// it pairs with that node as it runs, or with another as its client.
struct LocalNodeOpen: View {
    let mac: MacApp
    @Bindable var run: FirstRun
    @State private var elsewhere = false

    var body: some View {
        if elsewhere {
            JoinView(app: mac.app, handed: mac.handed)
        } else {
            Form {
                Section {
                    VStack(spacing: Space.s3) {
                        AppTile(size: 88)
                        Text("This Mac is a node").font(.largeTitle.bold())
                        Text(lines)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Space.s2)
                }
                .listRowBackground(Color.clear)
                if let stage = run.stage {
                    Section {
                        HStack(spacing: Space.s2) {
                            ProgressView().controlSize(.small)
                            Text(stage.words)
                        }
                    }
                }
                if let problem = run.problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                }
                Section {
                    Button {
                        run.open(app: mac.app)
                    } label: {
                        Text("Open It Here").fontWeight(.semibold)
                            .foregroundStyle(Prominent.label(dimmed: run.working))
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(run.working)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                } footer: {
                    Text("This app pairs with it as its own client. It is your account on this Mac, so there is no code to compare.")
                }
                Section {
                    Button("Pair with Another Node Instead…") { elsewhere = true }.disabled(run.working)
                }
            }
            .formStyle(.grouped)
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var lines: String {
        let config = try? NodeHome.standard.config()
        let name = config.map { "It is \($0.name), with its home in ~/.galahad." } ?? "Its home is ~/.galahad."
        return "\(name) This app can be its client too, and show you how it is kept running."
    }
}
#endif
