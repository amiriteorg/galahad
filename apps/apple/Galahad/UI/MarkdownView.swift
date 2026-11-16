import SwiftUI

/// His answer as the PWA draws it: paragraphs, headings, lists, quotes, rules, code and tables, in the system's own
/// type. Words only ever become text; a link is tappable only when it is a web address (`Markdown.safeHref`).
struct MarkdownView: View {
    let blocks: [Markdown.Block]

    init(_ source: String) { blocks = Markdown.parse(source) }
    init(blocks: [Markdown.Block]) { self.blocks = blocks }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                BlockView(block: block)
            }
        }
    }
}

private struct BlockView: View {
    let block: Markdown.Block

    var body: some View {
        switch block {
        case .p(let inlines):
            // Its whole height, however it wraps: beside a list's number it was cut to the lines a narrower guess allowed.
            Text(Inlines.attributed(inlines)).fixedSize(horizontal: false, vertical: true)
        case .h(let level, let inlines):
            Text(Inlines.attributed(inlines))
                .font(level == 1 ? .title3.bold() : level == 2 ? .headline : .subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, Space.line)
        case .code(let lang, let text, let open):
            // A block his answer shows beyond words (a chart, figures, choices, steps, a page); any other language is code.
            if let kind = Blocks.Kind(rawValue: lang.lowercased()) {
                AnswerBlock(kind: kind, text: text, open: open)
            } else {
                CodeBlock(lang: lang, text: text)
            }
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: Space.s2) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
                        Text(ordered ? "\(start + index)." : "•")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(minWidth: ordered ? 22 : 12, alignment: .trailing)
                            .accessibilityHidden(!ordered)
                        // The rest of the line is the item's: its words wrap at the bubble's edge, not sooner.
                        MarkdownView(blocks: item).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        case .quote(let blocks):
            HStack(alignment: .top, spacing: Space.s2) {
                Capsule().fill(.secondary.opacity(0.5)).frame(width: 3)
                MarkdownView(blocks: blocks).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .hr:
            Divider().padding(.vertical, Space.line)
        case .table(let align, let head, let rows):
            TableBlock(align: align, head: head, rows: rows)
        }
    }
}

/// Code, as written: monospaced, scrolled sideways rather than wrapped, and copied whole.
struct CodeBlock: View {
    let lang: String
    let text: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(lang.isEmpty ? "Code" : lang).font(.caption.monospaced()).foregroundStyle(.secondary)
                Spacer()
                Button {
                    Pasteboard.copy(text)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc").font(.caption)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(copied ? "Copied" : "Copy the code")
            }
            .padding(.horizontal, Space.s3)
            .padding(.top, Space.s2)
            ScrollView(.horizontal) {
                Text(text)
                    .font(.footnote.monospaced())
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(Space.s3)
            }
        }
        .background(.fill.quaternary, in: .rect(cornerRadius: Metrics.innerRadius, style: .continuous))
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }
}

/// A table: its head in bold, each column aligned as written, scrolled sideways when it's wider than the bubble.
private struct TableBlock: View {
    let align: [Markdown.Align?]
    let head: [[Markdown.Inline]]
    let rows: [[[Markdown.Inline]]]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: Space.s4, verticalSpacing: Space.s2) {
                GridRow {
                    ForEach(Array(head.enumerated()), id: \.offset) { column, cell in
                        Text(Inlines.attributed(cell)).font(.subheadline.weight(.semibold)).gridColumnAlignment(alignment(column))
                    }
                }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Text(Inlines.attributed(cell)).font(.subheadline)
                        }
                    }
                }
            }
            .fixedSize()
            .padding(.vertical, Space.line)
        }
    }

    private func alignment(_ column: Int) -> HorizontalAlignment {
        switch column < align.count ? align[column] : nil {
        case .center: .center
        case .right: .trailing
        default: .leading
        }
    }
}

/// Inline Markdown as one attributed string: bold, italic, struck, code in the monospaced face, and web links.
enum Inlines {
    static func attributed(_ inlines: [Markdown.Inline]) -> AttributedString {
        var out = AttributedString()
        append(inlines, to: &out, intent: [], struck: false, link: nil)
        return out
    }

    private static func append(_ inlines: [Markdown.Inline], to out: inout AttributedString, intent: InlinePresentationIntent, struck: Bool, link: URL?) {
        for inline in inlines {
            switch inline {
            case .text(let text): out += piece(text, intent: intent, struck: struck, link: link)
            case .code(let text): out += piece(text, intent: intent.union(.code), struck: struck, link: link)
            case .strong(let children): append(children, to: &out, intent: intent.union(.stronglyEmphasized), struck: struck, link: link)
            case .em(let children): append(children, to: &out, intent: intent.union(.emphasized), struck: struck, link: link)
            case .del(let children): append(children, to: &out, intent: intent, struck: true, link: link)
            case .link(let href, let children): append(children, to: &out, intent: intent, struck: struck, link: URL(string: href))
            case .br: out += AttributedString("\n")
            }
        }
    }

    private static func piece(_ text: String, intent: InlinePresentationIntent, struck: Bool, link: URL?) -> AttributedString {
        var piece = AttributedString(text)
        if !intent.isEmpty { piece.inlinePresentationIntent = intent }
        if struck { piece.strikethroughStyle = .single }
        if let link {
            piece.link = link
            piece.underlineStyle = .single
        }
        return piece
    }
}
