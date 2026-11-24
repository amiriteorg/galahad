@file:OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)

package org.amirite.galahad.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.KnightState
import org.amirite.galahad.core.Orb
import org.amirite.galahad.core.OrbMotion
import org.amirite.galahad.core.bool
import org.amirite.galahad.core.get
import org.amirite.galahad.core.string

/** What you might ask him first (the PWA's welcome's, the iPhone's): a press puts it in the message box, to send or change. */
private val SUGGESTIONS = listOf(
    "Catch me up" to "What has my fleet been doing today, and does anything need me?",
    "Plan" to "Plan this week's work on Galahad as a short, ordered list.",
    "Recall" to "What do we remember about how the fleet is deployed?",
    "Place" to "Which of my machines should run a long build, and why?",
)

/**
 * Galahad, the one you talk to (your word, 23 November 2026: for nearly everything, "a Jarvis … like visual, the orb
 * graphic"): his orb large in the colour of where he stands, moving as he is (24 November 2026: "pulsing/moving when
 * doing a task, sitting idle, waiting, done"), what he is doing, what he asks you, your chats with him, and the message
 * box. The app's first place and where it opens, as the iPhone's home is; a chat opens over it
 * ([openChat]), and what you send here starts one. The knights are a place away.
 */
@Composable
fun GalahadHome(app: AppModel, openChat: () -> Unit, showInbox: () -> Unit) {
    val table by app.table.collectAsState()
    val live by app.chat.live.collectAsState()
    val title by app.chat.title.collectAsState()
    val chats by app.chat.chats.collectAsState()
    var away by remember { mutableStateOf<List<Json>>(emptyList()) }
    // A suggestion pressed: handed to the message box (counted, so the same one pressed again is handed again).
    var offered by remember { mutableStateOf<Pair<Int, String>?>(null) }
    var presses by remember { mutableIntStateOf(0) }
    val problem by app.problem.collectAsState()
    val brand = LocalBrand.current
    val tone = Orb.tone(table.galahad.state)
    // His orb: at work while he answers the chat you left, before the node has said so; else where he stands.
    val standing = if (live) KnightState.WORKING else table.galahad.state
    // His line from the Roundtable this phone kept (app/KeptTable.kt), until the node answers: after a moment, a still
    // line says so, as the Roundtable's does, so what the home shows is never taken for what the node says now.
    var waited by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(table.asOf) {
        waited = false
        if (table.asOf != null) {
            kotlinx.coroutines.delay(1_500)
            waited = true
            // (Said again each minute, so how long ago stays true while the node is away.)
            while (true) {
                now = System.currentTimeMillis()
                kotlinx.coroutines.delay(60_000)
            }
        }
    }

    // Back here, the next message starts a chat of its own (the one you left stays on your node, under Recent).
    LaunchedEffect(Unit) {
        if (!app.chat.live.value) app.chat.fresh()
        away = app.away()
        if (away.isNotEmpty()) app.sawAway()
        app.chat.loadChats()
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(Modifier.weight(1f)) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = Space.margin, end = Space.s2, top = Space.s2), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { app.chat.fresh(); openChat() }, enabled = !live) { Text("New chat") }
                }
            }
            item {
                Column(Modifier.fillMaxWidth().padding(horizontal = Space.margin, vertical = Space.s2), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                    GalahadOrb(196.dp, Orb.tone(standing), "Galahad: ${table.galahad.text}", mood = OrbMotion.mood(standing))
                    Spacer(Modifier.height(Space.s1))
                    Text("Galahad", style = MaterialTheme.typography.headlineMediumEmphasized)
                    Text(
                        table.galahad.text,
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                        color = when (tone) {
                            Orb.Tone.WARN -> brand.needs
                            Orb.Tone.ACCENT -> brand.working
                            Orb.Tone.OK -> brand.done
                            Orb.Tone.DANGER -> brand.failed
                            Orb.Tone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
            problem?.let { p -> item { Refused(app, p) } }
            table.asOf?.takeIf { waited }?.let { at ->
                item {
                    val ago = if (now - at < 60_000) "just now" else android.text.format.DateUtils.getRelativeTimeSpanString(at, now, android.text.format.DateUtils.MINUTE_IN_MILLIS)
                    Text("As your node last said it, $ago. Asking it again.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = Space.margin))
                }
            }
            item {
                Column(Modifier.padding(horizontal = Space.margin, vertical = Space.s3), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                    for (pair in SUGGESTIONS.chunked(2)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                            for ((label, text) in pair) {
                                OutlinedButton(onClick = { offered = ++presses to text }, enabled = !live, modifier = Modifier.weight(1f)) { Text(label) }
                            }
                        }
                    }
                }
            }
            if (away.isNotEmpty()) {
                item {
                    Panel {
                        Text("While you were away", style = MaterialTheme.typography.titleSmallEmphasized)
                        for (line in away) {
                            val color = when (line["tone"].string) { "ok" -> brand.done; "warn" -> brand.needs; "danger" -> brand.failed; else -> MaterialTheme.colorScheme.onSurfaceVariant }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                                Dot(color)
                                Text(line["text"].string ?: "", style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                        TextButton(onClick = { away = emptyList() }, modifier = Modifier.align(Alignment.End)) { Text("Got it") }
                    }
                }
            }
            item { GalahadAsks(app, showInbox) }
            val recent = chats.take(4)
            if (recent.isNotEmpty()) item { SectionTitle("Recent", Modifier.padding(top = Space.s2)) }
            items(recent, key = { "c:${it["id"].string}" }) { c ->
                val state = c["state"].string
                Row(
                    Modifier.fillMaxWidth().clickable { c["id"].string?.let(app.chat::open); openChat() }.padding(horizontal = Space.margin, vertical = Space.s3),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.s2),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(c["title"].string ?: "A chat", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        state?.takeIf { it != "done" }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (it == "working") brand.working else MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    if (c["unread"].bool == true) Dot(brand.done)
                }
            }
            item { Spacer(Modifier.height(Space.s4)) }
        }
        if (live) {
            // While he answers in the chat you left, the box is that chat's: a press shows it.
            Row(
                Modifier.fillMaxWidth().clickable(onClick = openChat).padding(horizontal = Space.margin, vertical = Space.s3),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.s2),
            ) {
                Dot(brand.working, live = true)
                Text(title?.let { "Answering in “$it”" } ?: "Answering", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("Show", style = MaterialTheme.typography.labelLarge, color = brand.ink)
            }
        } else {
            ChatComposer(app, live = false, offered = offered, sent = openChat)
        }
    }
}
