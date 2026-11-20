package org.amirite.galahad.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.WideNavigationRail
import androidx.compose.material3.WideNavigationRailDefaults
import androidx.compose.material3.WideNavigationRailItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.app.Notices
import org.amirite.galahad.app.Updates
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.NodeClient
import org.amirite.galahad.core.NodeError

/** Where you are: one of the three places, or a page opened from one (Galahad's chat, a knight's page). */
private enum class Place(val label: String) { ROUNDTABLE("Roundtable"), INBOX("Inbox"), MORE("More") }

/** What's on screen, for the way it comes in: a page opened over a place comes in from the side and goes back there. */
private data class Screen(val place: Place, val chat: Boolean, val knight: String?, val room: String?) {
    val opened: Boolean get() = chat || knight != null || room != null
}

/**
 * The app once it's paired: the Roundtable, the Inbox and More, as the iPhone's tabs are, with Galahad's chat and each
 * knight's page opened from the Roundtable. Back closes what was opened, then returns to the Roundtable. On a phone the
 * places are a short bar at the foot; on a tablet or an open foldable, a rail at the side.
 */
@Composable
fun Root(app: AppModel) {
    var place by rememberSaveable { mutableStateOf(Place.ROUNDTABLE) }
    var chat by rememberSaveable { mutableStateOf(false) }
    var knight by rememberSaveable { mutableStateOf<String?>(null) }
    var room by rememberSaveable { mutableStateOf<String?>(null) }
    val inbox by app.inbox.collectAsState()
    val screen = Screen(place, chat, knight, room)
    // A tablet, or a foldable open (the window's width, as Android's own size classes read it).
    val wide = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() } >= 600.dp

    // A tapped notification: its place, or the chat it was about.
    val opening by app.opening.collectAsState()
    LaunchedEffect(opening) {
        val (open, conversation) = opening ?: return@LaunchedEffect
        knight = null
        room = null
        chat = open == "chat"
        if (chat) conversation?.let(app.chat::open)
        place = when (open) { "inbox" -> Place.INBOX; "settings" -> Place.MORE; else -> Place.ROUNDTABLE }
        app.opening.value = null
    }

    // Something shared from another app: a new chat, with it in the message box (the composer takes it from there).
    val shared by app.shared.collectAsState()
    LaunchedEffect(shared != null) {
        if (shared == null) return@LaunchedEffect
        knight = null
        room = null
        app.chat.fresh()
        chat = true
    }

    BackHandler(enabled = screen.opened || place != Place.ROUNDTABLE) {
        when {
            chat -> chat = false
            knight != null -> knight = null
            room != null -> room = null
            else -> place = Place.ROUNDTABLE
        }
    }
    val go = { to: Place ->
        chat = false
        knight = null
        room = null
        place = to
    }
    val icon: @Composable (Place) -> Unit = { p ->
        when (p) {
            Place.ROUNDTABLE -> Icon(roundtableIcon, null)
            Place.INBOX -> BadgedBox(badge = { if (inbox.count > 0) Badge(containerColor = LocalBrand.current.siege) { Text(AppModel.badge(inbox.count)) } }) { Icon(TrayIcon, null) }
            Place.MORE -> Icon(MoreIcon, null)
        }
    }

    Scaffold(
        bottomBar = {
            if (!wide && !screen.opened) {
                ShortNavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    for (p in Place.entries) ShortNavigationBarItem(selected = place == p, onClick = { go(p) }, icon = { icon(p) }, label = { Text(p.label) })
                }
            }
        },
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding)) {
            if (wide) {
                WideNavigationRail(colors = WideNavigationRailDefaults.colors(containerColor = MaterialTheme.colorScheme.surface)) {
                    for (p in Place.entries) WideNavigationRailItem(railExpanded = false, selected = place == p && !screen.opened, onClick = { go(p) }, icon = { icon(p) }, label = { Text(p.label) })
                }
            }
            // A page opens from the side and closes back to it (shared axis); one place gives way to another in place.
            AnimatedContent(
                targetState = screen,
                transitionSpec = {
                    // Springs without a bounce: quick to settle, nothing that plays on after you.
                    val slide = spring(Spring.DampingRatioNoBouncy, Spring.StiffnessMediumLow, IntOffset.VisibilityThreshold)
                    val fade = spring<Float>(Spring.DampingRatioNoBouncy, Spring.StiffnessMedium)
                    when {
                        targetState.opened && !initialState.opened -> (slideInHorizontally(slide) { it / 10 } + fadeIn(fade)) togetherWith fadeOut(fade)
                        !targetState.opened && initialState.opened -> fadeIn(fade) togetherWith (slideOutHorizontally(slide) { it / 10 } + fadeOut(fade))
                        else -> fadeIn(fade) togetherWith fadeOut(fade)
                    }
                },
                modifier = Modifier.weight(1f).fillMaxHeight(),
                label = "screen",
            ) { s ->
                Column(Modifier.fillMaxSize()) {
                    when {
                        s.chat -> ChatScreen(app) { chat = false }
                        s.knight != null -> KnightScreen(app, s.knight) { knight = null }
                        s.room != null -> RoomScreen(app, s.room) { room = null }
                        s.place == Place.ROUNDTABLE -> RoundtableScreen(app, openChat = { chat = true }, openKnight = { knight = it }, openRoom = { room = it })
                        s.place == Place.INBOX -> InboxScreen(app)
                        else -> MoreScreen(app)
                    }
                }
            }
        }
    }
}

/** This phone, its node, and the way out: forgetting the node here. */
@Composable
private fun MoreScreen(app: AppModel) {
    val paired by app.paired.collectAsState()
    var forgetting by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: ""
    var newer by remember { mutableStateOf<Updates.Newer?>(null) }
    LaunchedEffect(Unit) { newer = Updates.newer(context) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.margin), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
        Text("More", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        newer?.let { n ->
            Panel {
                Text("A newer Galahad is out", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Build ${n.build} (${n.size}). It installs over this one: open it once it's downloaded.", style = MaterialTheme.typography.bodyMedium)
                Button(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(n.url))) }) { Text("Download") }
            }
        }
        NotificationsPanel(app)
        paired?.let { p ->
            Panel {
                Text("Your node", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(p.fleetName ?: p.nodeName ?: "Galahad", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(p.origin, style = MaterialTheme.typography.bodyMedium)
            }
            Panel {
                Text("This phone", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(p.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Its key: ${p.device.take(14)}…", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                Text("Kept in this phone's secure hardware; every request is signed with it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Panel {
            Text("Galahad $version", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("Open source (Apache-2.0).", style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/amiriteorg/galahad"))) }) { Text("The source on GitHub") }
            TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://galahad.sh"))) }) { Text("galahad.sh") }
        }
        Spacer(Modifier.height(Space.s4))
        OutlinedButton(onClick = { forgetting = true }) { Text("Forget this node", color = LocalBrand.current.failed) }
    }
    if (forgetting) {
        AlertDialog(
            onDismissRequest = { forgetting = false },
            title = { Text("Forget this node?") },
            text = { Text("This phone's key goes too. To use Galahad here again, join with a fresh invite. Your node keeps everything; remove this phone from its devices there.") },
            confirmButton = { TextButton(onClick = { forgetting = false; app.forget() }) { Text("Forget it", color = LocalBrand.current.failed) } },
            dismissButton = { TextButton(onClick = { forgetting = false }) { Text("Cancel") } },
        )
    }
}

/**
 * Notifications on this phone: on and off, a test, and what Android allows. No push service carries them: the node
 * keeps them and this phone collects them (Notices). What he sends and when he stays quiet are the node's settings.
 */
@Composable
private fun NotificationsPanel(app: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(Notices.on(context)) }
    var allowed by remember { mutableStateOf(Notices.allowed(context)) }
    var said by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val brand = LocalBrand.current
    fun act(work: suspend (NodeClient) -> Unit) {
        val client = app.client ?: return
        busy = true
        scope.launch {
            try {
                work(client)
                said = null
            } catch (e: NodeError) {
                said = e.message
            } finally {
                busy = false
                on = Notices.on(context)
                allowed = Notices.allowed(context)
            }
        }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = Notices.allowed(context)
        if (granted) act { Notices.turnOn(context, it) } else said = "Android won't show them until notifications are allowed for Galahad."
    }
    Panel {
        Text("Notifications", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(
            if (on) "On. Your node keeps what it would tell you, and this phone collects it about every 15 minutes (Android may wait longer while the phone sleeps). No push service carries them."
            else "Off. Galahad can tell you here when something needs you: an approval, a question, a finding, work that ended. No push service carries them: this phone collects them from your node.",
            style = MaterialTheme.typography.bodyMedium,
        )
        if (on && !allowed) {
            Text("Android isn't showing them: notifications are off for Galahad.", style = MaterialTheme.typography.bodyMedium, color = brand.needs)
            TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) { Text("Open Android's settings") }
        }
        said?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = brand.failed) }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            if (on) {
                Button(enabled = !busy, onClick = {
                    act { client ->
                        client.post("/api/notify/test", Json.obj())
                        Notices.collect(context, client)
                    }
                }) { Text("Send a test") }
                TextButton(enabled = !busy, onClick = { act { Notices.turnOff(context, it) } }) { Text("Turn off") }
            } else {
                Button(enabled = !busy, onClick = {
                    if (Build.VERSION.SDK_INT >= 33 && !Notices.allowed(context)) ask.launch(android.Manifest.permission.POST_NOTIFICATIONS) else act { Notices.turnOn(context, it) }
                }) { Text("Turn on") }
            }
        }
        Text("What he sends, and the hours he stays quiet, are your node's settings: Settings in the web app, or galahad notify.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private val roundtableIcon: ImageVector = roundtableMark(Color.Black, Color.Black)
