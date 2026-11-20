package org.amirite.galahad.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.app.Attachments
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
    // His answer is followed as it comes, unless you've scrolled up to read: then it stays where you are.
    val following = remember { androidx.compose.runtime.derivedStateOf { !list.canScrollForward || list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 2 } == true } }
    LaunchedEffect(bubbles.size) { if (bubbles.isNotEmpty()) list.toEnd() }
    LaunchedEffect(bubbles.lastOrNull()?.text?.length) { if (bubbles.isNotEmpty() && following.value) list.toEnd() }
    // (A block is drawn only once its fence closes, after the last words came: the end moves once more as he finishes.)
    LaunchedEffect(live) { if (!live && bubbles.isNotEmpty() && following.value) list.toEnd() }

    // Back from your chats returns to this chat, not past it.
    BackHandler(enabled = listing) { listing = false }
    if (listing) {
        Chats(app, close = { listing = false })
        return
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        PageBar(title ?: "Galahad", back) {
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
            itemsIndexed(bubbles) { i, b -> Message(b, if (i == bubbles.lastIndex && !live) { choice -> chat.send(choice) } else null) }
            problem?.let { p -> item { Problem(p) } }
        }
        ChatComposer(app, live)
    }
}

/**
 * The chat's message box: your words, and the files they carry (a photo, drawn again smaller and without its metadata;
 * a text file), sent up to the node first and named by the message. While he answers it is Stop.
 */
@Composable
private fun ChatComposer(app: AppModel, live: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var files by remember { mutableStateOf<List<Attachments.Prepared>>(emptyList()) }
    var said by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val brand = LocalBrand.current
    fun add(read: suspend () -> Attachments.Prepared) = scope.launch {
        if (files.size >= Attachments.PER_MESSAGE) {
            said = "A message carries ${Attachments.PER_MESSAGE} files at most."
            return@launch
        }
        try {
            files = files + read()
            said = null
        } catch (e: Attachments.Refused) {
            said = e.message
        }
    }
    val photo = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri ->
        val photos = files.count { it.type.startsWith("image/") }
        uri?.let { u -> add { Attachments.picture(context, u, if (photos == 0) "Photo" else "Photo ${photos + 1}") } }
    }
    val textFile = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri -> uri?.let { u -> add { Attachments.text(context, u) } } }
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = Space.s3, vertical = Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s1)) {
        if (files.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                for (f in files) {
                    // (A button, not an input chip: that one reads to a screen reader as a checkbox, unchecked.)
                    androidx.compose.material3.AssistChip(
                        onClick = { files = files - f },
                        label = { Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        trailingIcon = { Icon(CloseIcon, null, Modifier.size(AssistChipDefaults.IconSize)) },
                        modifier = Modifier.semantics { contentDescription = "Remove ${f.name}" },
                    )
                }
            }
        }
        said?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = brand.failed) }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
            androidx.compose.foundation.layout.Box {
                TextButton(onClick = { menu = true }, enabled = !live && !sending, modifier = Modifier.padding(bottom = 4.dp)) { Text("Attach") }
                androidx.compose.material3.DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    androidx.compose.material3.DropdownMenuItem(text = { Text("A photo") }, onClick = {
                        menu = false
                        photo.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly))
                    })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("A text file") }, onClick = {
                        menu = false
                        textFile.launch("text/*")
                    })
                }
            }
            androidx.compose.material3.OutlinedTextField(value = text, onValueChange = { text = it }, placeholder = { Text("Ask Galahad") }, maxLines = 6, modifier = Modifier.weight(1f))
            if (live) {
                androidx.compose.material3.OutlinedButton(onClick = app.chat::stop, modifier = Modifier.padding(bottom = 4.dp)) { Text("Stop") }
            } else {
                androidx.compose.material3.Button(
                    enabled = (text.isNotBlank() || files.isNotEmpty()) && !sending,
                    modifier = Modifier.padding(bottom = 4.dp),
                    onClick = {
                        val client = app.client ?: return@Button
                        sending = true
                        scope.launch {
                            try {
                                val refs = files.map { Attachments.upload(client, it) }
                                app.chat.send(text, refs)
                                text = ""
                                files = emptyList()
                                said = null
                            } catch (e: org.amirite.galahad.core.NodeError) {
                                said = e.message
                            } catch (e: Attachments.Refused) {
                                said = e.message
                            } finally {
                                sending = false
                            }
                        }
                    },
                ) { Text(if (sending) "Sending" else "Send") }
            }
        }
    }
}

@Composable
private fun Message(b: Bubble, choose: ((String) -> Unit)?) {
    val brand = LocalBrand.current
    if (b.mine) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.margin, vertical = Space.s1), horizontalArrangement = Arrangement.End) {
            Column(Modifier.widthIn(max = 320.dp).clip(MaterialTheme.shapes.large).background(brand.ink).padding(horizontal = Space.s3, vertical = Space.s2)) {
                if (b.text.isNotEmpty()) Text(b.text, color = brand.onInk, style = MaterialTheme.typography.bodyLarge)
                for (f in b.files) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
                        Icon(AttachIcon, null, Modifier.size(16.dp), tint = brand.onInk.copy(alpha = 0.8f))
                        Text(f, color = brand.onInk.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
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
        PageBar("Chats", close)
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

/** To the very end of what's there: the foot of the last item, however tall (an answer is one item). */
suspend fun androidx.compose.foundation.lazy.LazyListState.toEnd() = scrollToItem(maxOf(0, layoutInfo.totalItemsCount - 1), Int.MAX_VALUE / 2)
