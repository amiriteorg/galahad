package org.amirite.galahad.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.app.Bubble
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.bool
import org.amirite.galahad.core.get
import org.amirite.galahad.core.string

/**
 * Galahad's chat: his face and what he's doing at the top, the conversation, and a box to write in. His answer comes in
 * as he writes it, with the steps he takes on the way under it; Stop asks the node to stop it, and leaving never does.
 * A fresh chat opens with what happened while you were away, from the node's own record (no model writes it).
 */
@Composable
fun ChatScreen(app: AppModel, back: () -> Unit) {
    val chat = app.chat
    val bubbles by chat.bubbles.collectAsState()
    val live by chat.live.collectAsState()
    val title by chat.title.collectAsState()
    val problem by chat.problem.collectAsState()
    val table by app.table.collectAsState()
    var listing by remember { mutableStateOf(false) }
    var away by remember { mutableStateOf<List<Json>>(emptyList()) }
    val list = rememberLazyListState()

    LaunchedEffect(Unit) {
        away = app.away()
        if (away.isNotEmpty()) app.sawAway()
    }
    LaunchedEffect(bubbles.size, bubbles.lastOrNull()?.text?.length) { if (bubbles.isNotEmpty()) list.scrollToItem(bubbles.size + 1) }

    if (listing) {
        Chats(app, close = { listing = false })
        return
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(Space.s2), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = back) { Text("Back") }
            Text(title ?: "Galahad", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            TextButton(onClick = { listing = true }) { Text("Chats") }
            TextButton(onClick = { chat.fresh() }, enabled = !live) { Text("New") }
        }
        LazyColumn(Modifier.weight(1f), state = list) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = Space.margin, vertical = Space.s2), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
                    Face("galahad", table.galahad.state, size = 48.dp)
                    Text(table.galahad.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
            }
            if (bubbles.isEmpty() && away.isNotEmpty()) {
                item {
                    Panel {
                        Text("While you were away", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        val brand = LocalBrand.current
                        for (line in away) {
                            val color = when (line["tone"].string) { "ok" -> brand.done; "warn" -> brand.needs; "danger" -> brand.failed; else -> MaterialTheme.colorScheme.onSurfaceVariant }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                                Dot(color)
                                Text(line["text"].string ?: "", style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
            // His latest answer's choices may be tapped, once he's done: the choice goes as your reply.
            itemsIndexed(bubbles) { i, b -> Message(b, if (i == bubbles.lastIndex && !live) chat::send else null) }
            problem?.let { p -> item { Problem(p) } }
        }
        Composer(placeholder = "Ask Galahad", asTask = null, sending = live, stop = if (live) chat::stop else null) { text, _ -> chat.send(text) }
    }
}

@Composable
private fun Message(b: Bubble, choose: ((String) -> Unit)?) {
    val brand = LocalBrand.current
    if (b.mine) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.margin, vertical = Space.s1), horizontalArrangement = Arrangement.End) {
            Text(
                b.text,
                color = brand.onInk,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(max = 320.dp).clip(MaterialTheme.shapes.large).background(brand.ink).padding(horizontal = Space.s3, vertical = Space.s2),
            )
        }
        return
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.margin, vertical = Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s1)) {
        if (b.text.isNotEmpty()) Markdown(b.text, choose = choose)
        for (step in b.steps.takeLast(4)) Text("· $step", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Work under way is a still dot and a word, never a spinner.
        if (b.streaming) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            Dot(brand.working)
            Text(if (b.text.isEmpty()) "Thinking" else "Writing", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        b.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = brand.failed) }
        if (b.status == "stopped" && b.error == null) Text("Stopped", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Your kept chats, the latest first: one opens where it was, and his answer still being written goes on there. */
@Composable
private fun Chats(app: AppModel, close: () -> Unit) {
    val chats by app.chat.chats.collectAsState()
    LaunchedEffect(Unit) { app.chat.loadChats() }
    val brand = LocalBrand.current
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(Space.s2), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = close) { Text("Back") }
            Text("Chats", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        LazyColumn(Modifier.weight(1f)) {
            items(chats, key = { it["id"].string ?: "" }) { c ->
                val state = c["state"].string
                Row(
                    Modifier.fillMaxWidth().clickable { c["id"].string?.let(app.chat::open); close() }.padding(horizontal = Space.margin, vertical = Space.s3),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.s2),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(c["title"].string ?: "A chat", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        state?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (it == "working") brand.working else MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    if (c["unread"].bool == true) Dot(brand.done)
                    if (state == "working") Dot(brand.working)
                }
            }
        }
    }
}
