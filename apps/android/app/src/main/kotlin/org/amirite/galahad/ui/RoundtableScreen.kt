@file:OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)

package org.amirite.galahad.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.KnightState
import org.amirite.galahad.core.Looks
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.Roster
import org.amirite.galahad.core.RosterRow

/**
 * The Roundtable, the app's home: Galahad first (his row opens his chat), then each knight with its state's ring and
 * word and one line of what it's doing, then each room. What only you can answer is marked; what's new to you since you
 * last looked, on any device, has a green dot, as an unread email does.
 */
@Composable
fun RoundtableScreen(app: AppModel, openChat: () -> Unit, openKnight: (String) -> Unit, openRoom: (String) -> Unit) {
    val table by app.table.collectAsState()
    val problem by app.problem.collectAsState()
    val paired by app.paired.collectAsState()
    var giving by remember { mutableStateOf(false) }
    // The last Roundtable this phone saw is drawn at once (app/KeptTable.kt). If the node hasn't answered in a moment,
    // a still line says what you're looking at; on a quick answer it never shows, so nothing comes and goes.
    var waited by remember { mutableStateOf(false) }
    LaunchedEffect(table.asOf) {
        waited = false
        if (table.asOf != null) {
            kotlinx.coroutines.delay(1_500)
            waited = true
        }
    }
    val knights = table.rows.filter { it.kind == "knight" }
    val rooms = table.rows.filter { it.kind == "room" }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = Space.margin, end = Space.s2, top = Space.s4, bottom = Space.s2), verticalAlignment = Alignment.CenterVertically) {
                Text(paired?.fleetName ?: "Roundtable", style = MaterialTheme.typography.headlineLargeEmphasized, modifier = Modifier.weight(1f))
                if (table.snapshot != null) TextButton(onClick = { giving = true }) { Text("Give a task") }
            }
        }
        problem?.let { p -> item { Refused(app, p) } }
        table.asOf?.takeIf { waited && problem == null }?.let { at ->
            item {
                val now = System.currentTimeMillis()
                val ago = if (now - at < 60_000) "just now" else android.text.format.DateUtils.getRelativeTimeSpanString(at, now, android.text.format.DateUtils.MINUTE_IN_MILLIS)
                Text("As your node last said it, $ago. Asking it again.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = Space.margin))
            }
        }
        if (table.snapshot == null && problem == null) item {
            Text("Asking your node…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(Space.margin))
        }
        // (His line says what he's doing: until the node has answered, there's nothing it could truly say.)
        if (table.snapshot != null) item {
            Seat(
                drawing = "galahad",
                name = "Galahad",
                state = table.galahad.state,
                line = table.galahad.text,
                needs = table.galahad.tone == "warn",
                unread = table.unread.isNotEmpty(),
                onClick = openChat,
            )
        }
        items(knights, key = { "k:${it.id}" }) { row ->
            Seat(Looks.of(row.id, row.name, row.avatar), row.name, row.state, row.line, row.needs, row.unread) { openKnight(row.id) }
        }
        if (table.snapshot != null && knights.isEmpty()) {
            item {
                Text(
                    "No knights yet. Galahad can seat one for you: ask him in his chat.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(Space.margin),
                )
            }
        }
        if (rooms.isNotEmpty()) {
            item { SectionTitle("Rooms", Modifier.padding(top = Space.s4)) }
            items(rooms, key = { "r:${it.id}" }) { row -> RoomSeat(row) { openRoom(row.id) } }
        }
        item { Spacer(Modifier.height(Space.s10)) }
    }
    if (giving) GiveDialog(app) { giving = false }
}

/**
 * What the node said, as what it means for you: a phone whose clock is a minute or more off is refused (set it to
 * automatic); a refusal with the clocks agreeing means the node no longer knows this phone (removed there), so the way
 * out is offered; anything else in the node's own words.
 */
@Composable
private fun Refused(app: AppModel, p: NodeError) {
    val skew = p.serverTime?.let { System.currentTimeMillis() - it }
    when {
        p.status == 401 && skew != null && Math.abs(skew) > 60_000 ->
            Problem("This phone's clock is ${Math.abs(skew) / 60_000} min ${if (skew > 0) "ahead of" else "behind"} your node's, and the node refuses requests that far out. Set the time to automatic in Settings.")
        p.status == 401 -> Column {
            Problem("Your node no longer knows this phone: it was removed there, or the node was set up again. Forget it here, then join with a fresh invite.")
            TextButton(onClick = app::forget, modifier = Modifier.padding(horizontal = Space.margin)) { Text("Forget this node", color = LocalBrand.current.failed) }
        }
        else -> Problem(p.message ?: "The node isn't answering.")
    }
}

/** One seat at the table: a face in its ring, the name and its state's word, and one line of what it's doing. */
@Composable
private fun Seat(drawing: String, name: String, state: KnightState?, line: String, needs: Boolean, unread: Boolean, onClick: () -> Unit) {
    val brand = LocalBrand.current
    val beside = Roster.besideChip(line, state)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { role = Role.Button }
            .padding(horizontal = Space.margin, vertical = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        Face(drawing, state)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text(name, style = MaterialTheme.typography.titleMediumEmphasized, maxLines = 1, overflow = TextOverflow.Ellipsis)
                StateChip(state)
                if (unread) Box(Modifier.clearAndSetSemantics { contentDescription = "new" }) { Dot(brand.done) }
            }
            if (beside.isNotEmpty()) {
                Text(
                    beside,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (needs) brand.needs else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun RoomSeat(row: RosterRow, onClick: () -> Unit) {
    val brand = LocalBrand.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).semantics(mergeDescendants = true) { role = Role.Button }.padding(horizontal = Space.margin, vertical = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        // (A room's mark, for the eye only: a screen reader says its name.)
        Box(Modifier.size(Space.rowFace).clip(CircleShape).background(brand.raised).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
            Text("#", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text(row.name, style = MaterialTheme.typography.titleMediumEmphasized, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (row.unread) Dot(brand.done)
            }
            Text(row.line, style = MaterialTheme.typography.bodyMedium, color = if (row.needs) brand.needs else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A task given to the Roundtable: the knight best suited to it takes it, in its conversation with you. */
@Composable
private fun GiveDialog(app: AppModel, done: () -> Unit) {
    var goal by remember { mutableStateOf("") }
    var said by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = done,
        title = { Text("Give a task to the Roundtable") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text("The knight best suited to it takes it. You'll see who in its row.", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(value = goal, onValueChange = { goal = it }, label = { Text("What's to be done") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                said?.let { Text(it, color = LocalBrand.current.needs) }
            }
        },
        confirmButton = {
            TextButton(enabled = goal.isNotBlank() && !sending, onClick = {
                sending = true
                scope.launch {
                    try {
                        val given = app.client?.post("/api/team/give", Json.obj("goal" to goal.trim()))
                        app.refresh()
                        said = null
                        given?.let { done() }
                    } catch (e: NodeError) {
                        said = e.message
                    } finally {
                        sending = false
                    }
                }
            }) { Text("Give it") }
        },
        dismissButton = { TextButton(onClick = done) { Text("Cancel") } },
    )
}

