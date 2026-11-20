@file:OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)

package org.amirite.galahad.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.Roster
import org.amirite.galahad.core.bool
import org.amirite.galahad.core.double
import org.amirite.galahad.core.get
import org.amirite.galahad.core.list
import org.amirite.galahad.core.long
import org.amirite.galahad.core.string
import org.amirite.galahad.core.text

/**
 * What only you can answer: approvals (read what it would do, then yes or no; no answer before it expires is no),
 * services' questions, keys a knight or Galahad asked for, and devices asking to join. Each answer goes to the node at
 * once, signed by this phone's key; nothing here is answered for you.
 */
@Composable
fun InboxScreen(app: AppModel) {
    val inbox by app.inbox.collectAsState()
    val table by app.table.collectAsState()
    var said by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun act(block: suspend () -> Unit) = scope.launch {
        try {
            block()
            said = null
        } catch (e: NodeError) {
            said = e.message
        }
    }
    val knights = table.snapshot?.teammates ?: emptyList()
    fun asker(by: String): String = Roster.knightOfCaller(by)?.let { id -> knights.firstOrNull { it.id == id }?.name ?: id }
        ?: if (by.startsWith("loop:")) "The loop ${by.removePrefix("loop:")}" else if (by == "galahad" || by.startsWith("arm:") || by.startsWith("n_")) "Galahad" else by

    LazyColumn(Modifier.fillMaxSize()) {
        item { Text("Inbox", style = MaterialTheme.typography.headlineLargeEmphasized, modifier = Modifier.padding(start = Space.margin, top = Space.s4, bottom = Space.s2)) }
        said?.let { item { Problem(it) } }
        if (inbox.count == 0) {
            item { Text("Nothing needs you.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(Space.margin)) }
        }
        if (inbox.actions.isNotEmpty()) item { SectionTitle("Approvals") }
        items(inbox.actions, key = { "a:${it["id"].string}" }) { a -> Approval(a, asker(a["by"].string ?: "")) { approve -> act { app.decide(a["id"].string!!, approve) } } }
        if (inbox.questions.isNotEmpty()) item { SectionTitle("Questions") }
        items(inbox.questions, key = { "q:${it["id"].string}" }) { q -> Question(q) { accept, content -> act { app.answerQuestion(q["id"].string!!, accept, content) } } }
        if (inbox.keys.isNotEmpty()) item { SectionTitle("Keys asked for") }
        items(inbox.keys, key = { "k:${it["name"].string}" }) { k ->
            KeyAsked(k, asker(k["requestedBy"].string ?: ""), seal = { value -> act { app.sealKey(k["name"].string!!, value, k["provider"].string) } }, dismiss = { act { app.dismissKey(k["name"].string!!) } })
        }
        if (inbox.pairings.isNotEmpty()) item { SectionTitle("Devices asking to join") }
        items(inbox.pairings, key = { "p:${it["device"].string}" }) { p ->
            Panel {
                Text(p["name"].string ?: "A device", style = MaterialTheme.typography.titleMediumEmphasized)
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                    Text("Its code", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(p["sas"].string ?: "", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.headlineSmallEmphasized)
                }
                Text("Approve only if this is the code that device shows.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (p["conflict"].bool == true) Text("Two devices asked with one invite: approving either is refused.", color = LocalBrand.current.failed)
                Decision(
                    no = "Decline",
                    yes = "Approve",
                    onNo = { act { app.answerPairing(p["invite"].string!!, p["device"].string!!, false) } },
                    onYes = { act { app.answerPairing(p["invite"].string!!, p["device"].string!!, true) } },
                )
            }
        }
        item { Spacer(Modifier.height(Space.s10)) }
    }
}

/** An approval as you read it before you answer: who asks, what it would do and to what, why, and the request itself. */
@Composable
private fun Approval(a: Json, who: String, answer: (Boolean) -> Unit) {
    val brand = LocalBrand.current
    var shown by remember { mutableStateOf(false) }
    val kind = a["class"].string
    val left = (a["expires"].long ?: 0) - System.currentTimeMillis()
    Panel {
        Text("$who asks", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${a["connector"].string}.${a["tool"].string}", style = MaterialTheme.typography.titleMediumEmphasized)
        Text(a["target"].string ?: "", style = MaterialTheme.typography.bodyMedium)
        when (kind) {
            "delete" -> Text("It deletes something.", color = brand.failed, style = MaterialTheme.typography.bodyMedium)
            "outward" -> Text("It sends something out of your fleet.", color = brand.needs, style = MaterialTheme.typography.bodyMedium)
        }
        a["why"].string?.let { Text("Why: $it", style = MaterialTheme.typography.bodyMedium) }
        TextButton(onClick = { shown = !shown }) { Text(if (shown) "Hide the request" else "Read the request") }
        if (shown) Text(a["args"]?.let(::pretty) ?: "{}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
        Text(if (left > 60_000) "No answer within ${within(left)} is a no." else "It expires now: no answer is a no.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Decision(no = "Decline", yes = "Approve", onNo = { answer(false) }, onYes = { answer(true) })
    }
}

/** A service's question, asked mid-call (MCP elicitation): its fields as a form, checked again on the node. */
@Composable
private fun Question(q: Json, answer: (Boolean, Map<String, Any?>) -> Unit) {
    val values = remember(q["id"].string) { mutableStateMapOf<String, Any?>() }
    Panel {
        Text("${q["label"].string ?: q["connector"].string} asks", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(q["message"].string ?: "", style = MaterialTheme.typography.titleMedium)
        for (f in q["fields"].list) {
            val name = f["name"].string ?: continue
            val title = f["title"].string ?: name
            when (f["kind"].string) {
                "yes-no" -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, modifier = Modifier.weight(1f))
                    Switch(checked = (values[name] ?: f["default"].bool ?: false) as Boolean, onCheckedChange = { values[name] = it })
                }
                "one" -> Column {
                    Text(title, style = MaterialTheme.typography.labelLarge)
                    for (o in f["options"].list) Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = (values[name] ?: f["default"].string) == o["value"].string, onClick = { values[name] = o["value"].string })
                        Text(o["title"].string ?: o["value"].string ?: "")
                    }
                }
                "many" -> Column {
                    Text(title, style = MaterialTheme.typography.labelLarge)
                    for (o in f["options"].list) {
                        @Suppress("UNCHECKED_CAST") val chosen = (values[name] as? List<String>) ?: f["default"].list.mapNotNull { it.string }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = o["value"].string in chosen, onCheckedChange = { on -> values[name] = if (on) chosen + o["value"].string!! else chosen - o["value"].string!! })
                            Text(o["title"].string ?: o["value"].string ?: "")
                        }
                    }
                }
                else -> OutlinedTextField(
                    value = (values[name] as? String) ?: f["default"].let { it.string ?: it.double?.let { d -> if (d % 1.0 == 0.0) d.toLong().toString() else d.toString() } } ?: "",
                    onValueChange = { values[name] = it },
                    label = { Text(title) },
                    supportingText = f["description"].string?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = if (f["kind"].string == "number") KeyboardType.Decimal else KeyboardType.Text),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            OutlinedButton(onClick = { answer(false, emptyMap()) }) { Text("Decline") }
            Button(onClick = {
                val content = q["fields"].list.associate { f ->
                    val name = f["name"].string!!
                    val v = values[name]
                    name to when (f["kind"].string) {
                        "number" -> (v as? String)?.toDoubleOrNull() ?: f["default"].double
                        "yes-no" -> v ?: f["default"].bool
                        "one" -> v ?: f["default"].string
                        "many" -> v ?: f["default"].list.mapNotNull { it.string }.ifEmpty { null }
                        else -> (v as? String)?.ifBlank { null } ?: f["default"].string
                    }
                }
                answer(true, content)
            }) { Text("Answer") }
        }
    }
}

/** A key asked for: it goes into the vault, sealed, and is never shown again (here or anywhere). */
@Composable
private fun KeyAsked(k: Json, who: String, seal: (String) -> Unit, dismiss: () -> Unit) {
    var adding by remember { mutableStateOf(false) }
    Panel {
        Text("$who asks for a key", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(k["name"].string ?: "", style = MaterialTheme.typography.titleMediumEmphasized, fontFamily = FontFamily.Monospace)
        Text(k["purpose"].string ?: "", style = MaterialTheme.typography.bodyMedium)
        Decision(no = "Dismiss", yes = "Add the key", onNo = dismiss, onYes = { adding = true })
    }
    if (adding) {
        var value by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Add ${k["name"].string}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                    Text("It's sealed in your node's vault and never shown again.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it },
                        label = { Text("The key") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = { TextButton(enabled = value.isNotBlank(), onClick = { seal(value.trim()); value = ""; adding = false }) { Text("Seal it") } },
            dismissButton = { TextButton(onClick = { value = ""; adding = false }) { Text("Cancel") } },
        )
    }
}

/** A while, as it's said: minutes under an hour, hours under two days, else days. */
private fun within(ms: Long): String {
    val minutes = ms / 60_000
    val hours = (ms + 1_800_000) / 3_600_000
    return when {
        minutes < 60 -> "$minutes min"
        hours < 48 -> "$hours hour${if (hours == 1L) "" else "s"}"
        else -> "${(ms + 43_200_000) / 86_400_000} days"
    }
}

/** A request's arguments as you read them: indented, one field a line. */
private fun pretty(j: Json, indent: String = ""): String = when (j) {
    is Json.Obj -> if (j.fields.isEmpty()) "{}" else j.fields.entries.joinToString(",\n", "{\n", "\n$indent}") { (k, v) -> "$indent  \"$k\": ${pretty(v, "$indent  ")}" }
    is Json.Arr -> if (j.items.isEmpty()) "[]" else j.items.joinToString(",\n", "[\n", "\n$indent]") { "$indent  ${pretty(it, "$indent  ")}" }
    else -> j.text()
}
