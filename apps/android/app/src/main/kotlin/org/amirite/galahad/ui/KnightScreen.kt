package org.amirite.galahad.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.KnightState
import org.amirite.galahad.core.Looks
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.Roster
import org.amirite.galahad.core.bool
import org.amirite.galahad.core.get
import org.amirite.galahad.core.list
import org.amirite.galahad.core.long
import org.amirite.galahad.core.string

/** A line of a knight's timeline: something said, or a task as it stands. */
private data class Entry(val at: Long, val key: String, val speaker: String?, val mine: Boolean, val text: String, val task: Json?)

/**
 * A knight's page: its face and state, then its timeline (what you and it said, and its tasks as they stand, oldest
 * first), and a box to write to it or to give it a task. Read again every four seconds while it's open (two while it
 * works); opening it is looking, so what ended here is no longer new to you.
 */
@Composable
fun KnightScreen(app: AppModel, id: String, back: () -> Unit) {
    val table by app.table.collectAsState()
    val row = table.rows.firstOrNull { it.kind == "knight" && it.id == id }
    val person = table.snapshot?.teammates?.firstOrNull { it.id == id }
    var room by remember { mutableStateOf<String?>(null) }
    var entries by remember { mutableStateOf<List<Entry>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()

    suspend fun read() {
        val c = app.client ?: return
        try {
            val r = room ?: c.post("/api/team/direct", Json.obj("id" to id))["room"].let { it.string ?: it["id"].string }.also { room = it }
            val view = c.post("/api/team/room", Json.obj("id" to r))
            val said = view["messages"].list.map { m ->
                val speaker = m["speaker"].string ?: ""
                Entry(m["createdAt"].long ?: 0, "m:${m["id"].string ?: m["createdAt"].long}", if (speaker == "owner") null else m["speakerName"].string ?: person?.name ?: speaker, speaker == "owner", m["text"].string ?: "", null)
            }
            val tasks = view["tasks"].list.filter { it["assignee"].string == id }.map { t -> Entry(t["createdAt"].long ?: t["updatedAt"].long ?: 0, "t:${t["id"].string}", null, false, "", t) }
            entries = (said + tasks).sortedBy { it.at }
            problem = null
        } catch (e: NodeError) {
            problem = e.message
        }
    }

    LaunchedEffect(id) {
        runCatching { app.client?.post("/api/team/seen", Json.obj("knight" to id)) }
        while (true) {
            read()
            delay(if (row?.state == KnightState.WORKING) 2_000 else 4_000)
        }
    }
    LaunchedEffect(entries.size) { if (entries.isNotEmpty()) list.scrollToItem(entries.size) }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(Space.s2), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = back) { Text("Back") }
        }
        LazyColumn(Modifier.weight(1f), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = Space.s4)) {
            item {
                Column(Modifier.fillMaxWidth().padding(Space.margin), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                    Face(Looks.of(id, person?.name ?: id, person?.avatar), row?.state, size = 120.dp, description = person?.name)
                    Text(person?.name ?: id, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    StateChip(row?.state)
                    row?.let { Text(Roster.besideChip(it.line, it.state), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            problem?.let { item { Problem(it) } }
            items(entries, key = { it.key }) { e -> if (e.task != null) TaskCard(app, e.task) else Said(e) }
        }
        Composer(
            placeholder = "Write to ${person?.name ?: id}",
            asTask = "Give it as a task",
            sending = false,
            onSend = { text, task ->
                val r = room ?: return@Composer
                scope.launch {
                    try {
                        if (task) {
                            val title = text.lineSequence().first().take(200)
                            app.client?.post("/api/team/tasks", Json.obj("room" to r, "assignee" to id, "title" to title, "goal" to text))
                        } else {
                            app.client?.post("/api/team/messages", Json.obj("room" to r, "text" to text))
                        }
                        read()
                        app.refresh()
                    } catch (e: NodeError) {
                        problem = e.message
                    }
                }
            },
        )
    }
}

@Composable
private fun Said(e: Entry) {
    val brand = LocalBrand.current
    Row(Modifier.fillMaxWidth().padding(horizontal = Space.margin, vertical = Space.s1), horizontalArrangement = if (e.mine) Arrangement.End else Arrangement.Start) {
        if (e.mine) {
            Text(
                e.text,
                color = brand.onInk,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(max = 320.dp).clip(MaterialTheme.shapes.large).background(brand.ink).padding(horizontal = Space.s3, vertical = Space.s2),
            )
        } else {
            Column(Modifier.widthIn(max = 360.dp)) {
                e.speaker?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Markdown(e.text)
            }
        }
    }
}

/** A task as it stands: its title, its state in a word, its latest line; a proposal waits for your yes or no. */
@Composable
private fun TaskCard(app: AppModel, t: Json) {
    val scope = rememberCoroutineScope()
    val status = t["status"].string ?: ""
    val verified = t["verified"].bool == true
    val state = when (status) {
        "running" -> KnightState.WORKING
        "proposed" -> KnightState.NEEDS
        "failed" -> KnightState.FAILED
        "queued" -> KnightState.QUEUED
        "done" -> if (verified) KnightState.VERIFIED else null
        else -> null
    }
    val word = when (status) {
        "done" -> if (verified) "Verified" else "Done"
        "proposed" -> "Proposed"
        "stopped" -> "Stopped"
        "interrupted" -> "Interrupted"
        else -> state?.words
    }
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            Text("Task", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            word?.let { w -> Text(w, style = MaterialTheme.typography.labelMedium, color = state?.tone?.let(LocalBrand.current::of) ?: MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Text(t["title"].string ?: "", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        (t["progress"].string ?: t["error"].string)?.takeIf { it.isNotBlank() }?.let { Text(it.lineSequence().first(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (status == "proposed") {
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                OutlinedButton(onClick = { scope.launch { runCatching { app.client?.post("/api/team/control", Json.obj("task" to t["id"].string, "action" to "stop")); app.refresh() } } }) { Text("Decline") }
                androidx.compose.material3.Button(onClick = { scope.launch { runCatching { app.client?.post("/api/team/control", Json.obj("task" to t["id"].string, "action" to "approve")); app.refresh() } } }) { Text("Start it") }
            }
        }
    }
}

/** A box to write in, with Send; [asTask] offers the same words as a task instead. */
@Composable
fun Composer(placeholder: String, asTask: String?, sending: Boolean, stop: (() -> Unit)? = null, onSend: (String, Boolean) -> Unit) {
    var text by remember { mutableStateOf("") }
    var task by remember { mutableStateOf(false) }
    val brand = LocalBrand.current
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = Space.s3, vertical = Space.s2)) {
        if (asTask != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = task, onCheckedChange = { task = it })
                Text(asTask, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            androidx.compose.material3.OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text(placeholder) },
                maxLines = 6,
                modifier = Modifier.weight(1f),
            )
            if (stop != null) {
                OutlinedButton(onClick = stop, modifier = Modifier.padding(bottom = 4.dp)) { Text("Stop") }
            } else {
                androidx.compose.material3.Button(
                    onClick = {
                        onSend(text.trim(), task)
                        text = ""
                    },
                    enabled = text.isNotBlank() && !sending,
                    modifier = Modifier.padding(bottom = 4.dp),
                ) { Text("Send", color = if (text.isNotBlank()) brand.onInk else MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}
