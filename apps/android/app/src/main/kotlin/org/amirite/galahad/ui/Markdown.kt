package org.amirite.galahad.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import org.amirite.galahad.core.Blocks

/** A block of an answer: what Markdown he writes comes to, as this app shows it. */
private sealed interface Part {
    data class Heading(val level: Int, val text: String) : Part
    data class Para(val text: String) : Part
    data class Item(val marker: String, val text: String) : Part
    data class Quote(val text: String) : Part
    /** A fenced block: code, or one of his answer blocks by its language. `open`: still being written. */
    data class Fence(val lang: String, val text: String, val open: Boolean) : Part
    data class Table(val rows: List<List<String>>) : Part
}

private val tableRule = Regex("^\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?$")

private fun cells(line: String): List<String> = line.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }

private fun parts(text: String): List<Part> {
    val out = ArrayList<Part>()
    val lines = text.replace("\r\n", "\n").split("\n")
    var i = 0
    val para = StringBuilder()
    fun flush() {
        if (para.isNotBlank()) out += Part.Para(para.toString().trim())
        para.clear()
    }
    while (i < lines.size) {
        val line = lines[i]
        val t = line.trimStart()
        when {
            t.startsWith("```") -> {
                flush()
                val lang = t.removePrefix("```").trim().substringBefore(' ').lowercase()
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                    code.appendLine(lines[i])
                    i++
                }
                out += Part.Fence(lang, code.toString().trimEnd('\n'), open = i >= lines.size)
            }
            Regex("^#{1,6} ").containsMatchIn(t) -> {
                flush()
                val level = t.takeWhile { it == '#' }.length
                out += Part.Heading(level, t.drop(level).trim())
            }
            Regex("^[-*+] ").containsMatchIn(t) -> { flush(); out += Part.Item("•", t.drop(2)) }
            Regex("^\\d+[.)] ").containsMatchIn(t) -> { flush(); val n = t.takeWhile { it.isDigit() }; out += Part.Item("$n.", t.drop(n.length + 2)) }
            t.startsWith(">") -> { flush(); out += Part.Quote(t.drop(1).trim()) }
            t.startsWith("|") && i + 1 < lines.size && tableRule.matches(lines[i + 1].trim()) -> {
                flush()
                val rows = arrayListOf(cells(t))
                i += 2
                while (i < lines.size && lines[i].trimStart().startsWith("|")) {
                    rows += cells(lines[i])
                    i++
                }
                out += Part.Table(rows)
                continue
            }
            t.isEmpty() -> flush()
            else -> {
                if (para.isNotEmpty()) para.append('\n')
                para.append(line)
            }
        }
        i++
    }
    flush()
    return out
}

private val bareLink = Regex("^https?://[^\\s<>()]+[^\\s<>().,;:!?'\"]")

/** Bold, italics, struck through, code and links inside a line; a bare address is a link too. */
private fun inline(text: String, code: SpanStyle, link: Color): AnnotatedString = buildAnnotatedString {
    var i = 0
    val linkStyle = TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline))
    while (i < text.length) {
        val rest = text.substring(i)
        val tick = Regex("^`([^`]+)`").find(rest)
        val bold = Regex("^\\*\\*(.+?)\\*\\*").find(rest)
        val struck = Regex("^~~(.+?)~~").find(rest)
        val a = Regex("^\\[([^\\]]+)]\\((https?://[^)\\s]+)\\)").find(rest)
        val bare = if (i == 0 || !text[i - 1].isLetterOrDigit()) bareLink.find(rest) else null
        val italic = Regex("^[*_](?![*_\\s])(.+?)[*_]").find(rest)
        when {
            tick != null -> { withStyle(code) { append(tick.groupValues[1]) }; i += tick.value.length }
            bold != null -> { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(inline(bold.groupValues[1], code, link)) }; i += bold.value.length }
            struck != null -> { withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(struck.groupValues[1]) }; i += struck.value.length }
            a != null -> { withLink(LinkAnnotation.Url(a.groupValues[2], linkStyle)) { append(a.groupValues[1]) }; i += a.value.length }
            bare != null -> { withLink(LinkAnnotation.Url(bare.value, linkStyle)) { append(bare.value) }; i += bare.value.length }
            italic != null && (i == 0 || !text[i - 1].isLetterOrDigit()) -> { withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(italic.groupValues[1]) }; i += italic.value.length }
            else -> { append(text[i]); i++ }
        }
    }
}

/**
 * An answer as he wrote it: headings, paragraphs, lists, quotes, tables and code, and his answer blocks drawn live
 * (a chart, figures, steps, choices to tap, a page). [choose], where given, sends a tapped choice as your reply.
 */
@Composable
fun Markdown(text: String, modifier: Modifier = Modifier, choose: ((String) -> Unit)? = null) {
    val blocks = remember(text) { parts(text) }
    val brand = LocalBrand.current
    val code = SpanStyle(fontFamily = FontFamily.Monospace, background = brand.raised)
    val type = MaterialTheme.typography
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        for (b in blocks) when (b) {
            is Part.Heading -> SelectionContainer { Text(inline(b.text, code, brand.working), style = if (b.level <= 2) type.titleLarge else type.titleMedium, fontWeight = FontWeight.SemiBold) }
            is Part.Para -> SelectionContainer { Text(inline(b.text, code, brand.working), style = type.bodyLarge) }
            is Part.Item -> Row {
                Text(b.marker, style = type.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(24.dp))
                SelectionContainer { Text(inline(b.text, code, brand.working), style = type.bodyLarge) }
            }
            is Part.Quote -> Row(Modifier.fillMaxWidth()) {
                Box(Modifier.width(3.dp).padding(vertical = 2.dp).background(brand.line))
                Text(inline(b.text, code, brand.working), style = type.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = Space.s3))
            }
            is Part.Table -> TableBlock(b.rows, code)
            is Part.Fence -> FenceBlock(b, choose)
        }
    }
}

@Composable
private fun TableBlock(rows: List<List<String>>, code: SpanStyle) {
    val brand = LocalBrand.current
    val columns = rows.maxOf { it.size }
    Box(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).background(brand.raised).horizontalScroll(rememberScrollState())) {
        Column(Modifier.padding(vertical = Space.s1)) {
            rows.forEachIndexed { r, row ->
                Row {
                    for (c in 0 until columns) {
                        Text(
                            inline(row.getOrElse(c) { "" }, code, brand.working),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (r == 0) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.width(120.dp).padding(horizontal = Space.s3, vertical = Space.s1),
                        )
                    }
                }
            }
        }
    }
}

private val pendingWords = mapOf(
    "chart" to "Drawing a chart…", "stats" to "Gathering figures…", "choices" to "Writing choices…", "steps" to "Planning steps…",
    "artifact" to "Making a page: it opens when he's done",
)

@Composable
private fun FenceBlock(b: Part.Fence, choose: ((String) -> Unit)?) {
    val lang = b.lang
    val page = lang == "artifact" || (lang == "html" && Blocks.artifact(b.text) is Blocks.Read.Ok)
    if ((lang in Blocks.kinds || page) && b.open) {
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            Dot(LocalBrand.current.working)
            Text(pendingWords[lang] ?: "Drawing…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    if (page) {
        when (val read = Blocks.artifact(b.text)) {
            is Blocks.Read.Ok -> PageCard(read.value)
            is Blocks.Read.No -> Refused("page", read.why, b.text)
        }
        return
    }
    when (lang) {
        "chart" -> when (val read = Blocks.chart(b.text)) {
            is Blocks.Read.Ok -> ChartBlock(read.value)
            is Blocks.Read.No -> Refused("chart", read.why, b.text)
        }
        "stats" -> when (val read = Blocks.stats(b.text)) {
            is Blocks.Read.Ok -> StatsBlock(read.value)
            is Blocks.Read.No -> Refused("figures", read.why, b.text)
        }
        "choices" -> when (val read = Blocks.choices(b.text)) {
            is Blocks.Read.Ok -> ChoicesBlock(read.value, choose)
            is Blocks.Read.No -> Refused("choices", read.why, b.text)
        }
        "steps" -> when (val read = Blocks.steps(b.text)) {
            is Blocks.Read.Ok -> StepsBlock(read.value)
            is Blocks.Read.No -> Refused("steps", read.why, b.text)
        }
        else -> CodeBlock(b.text)
    }
}

@Composable
fun CodeBlock(text: String) {
    SelectionContainer {
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
            softWrap = false,
            modifier = Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .background(LocalBrand.current.raised)
                .horizontalScroll(rememberScrollState())
                .padding(Space.s3),
        )
    }
}

/** A block that couldn't be drawn: why, then the code it is. */
@Composable
private fun Refused(what: String, why: String, text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Space.s1)) {
        Text("This $what couldn't be drawn: $why.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        CodeBlock(text)
    }
}
