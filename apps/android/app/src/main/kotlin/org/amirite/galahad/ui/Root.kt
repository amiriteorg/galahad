@file:OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)

package org.amirite.galahad.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.app.Notices
import org.amirite.galahad.app.UnifiedPush
import org.amirite.galahad.app.Updates
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.NodeClient
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.Orb
import org.amirite.galahad.core.get
import org.amirite.galahad.core.string

/**
 * Where you are: one of the four places, or a page opened from one (Galahad's chat, a knight's page). Galahad at the bar's
 * right end (your word, 23 November 2026: Galahad the right-most in the bar), and where the app opens: he is the one you
 * talk to, for nearly everything.
 */
private enum class Place(val label: String) { ROUNDTABLE("Roundtable"), INBOX("Inbox"), MORE("More"), GALAHAD("Galahad") }

/** What's on screen, for the way it comes in: a page opened over a place comes in from the side and goes back there. */
private data class Screen(val place: Place, val chat: Boolean, val knight: String?, val room: String?, val keys: Boolean, val connectors: Boolean, val mac: String?) {
    val opened: Boolean get() = chat || knight != null || room != null || keys || connectors || mac != null
}

/**
 * The app once it's paired: Galahad, the Roundtable, the Inbox and More, as the iPhone's tabs are, with his chat opened
 * over his home and each knight's page from the Roundtable. Back closes what was opened, then returns to Galahad. On a
 * phone the places are a short bar at the foot; on a tablet or an open foldable, a rail at the side.
 */
@Composable
fun Root(app: AppModel) {
    var place by rememberSaveable { mutableStateOf(Place.GALAHAD) }
    var chat by rememberSaveable { mutableStateOf(false) }
    var knight by rememberSaveable { mutableStateOf<String?>(null) }
    var room by rememberSaveable { mutableStateOf<String?>(null) }
    var keys by rememberSaveable { mutableStateOf(false) }
    var connectors by rememberSaveable { mutableStateOf(false) }
    // A Mac he is using itself, watched from the Inbox (its node).
    var mac by rememberSaveable { mutableStateOf<String?>(null) }
    val inbox by app.inbox.collectAsState()
    val table by app.table.collectAsState()
    val focus = LocalFocusManager.current
    val screen = Screen(place, chat, knight, room, keys, connectors, mac)
    // A tablet, or a foldable open (the window's width, as Android's own size classes read it).
    val wide = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() } >= 600.dp
    val motion = MaterialTheme.motionScheme

    // A tapped notification: its place, or the chat it was about.
    val opening by app.opening.collectAsState()
    LaunchedEffect(opening) {
        val (open, conversation) = opening ?: return@LaunchedEffect
        knight = null
        room = null
        keys = false
        connectors = false
        mac = null
        chat = open == "chat"
        if (chat) conversation?.let(app.chat::open)
        place = when (open) { "chat" -> Place.GALAHAD; "inbox" -> Place.INBOX; "settings" -> Place.MORE; else -> Place.ROUNDTABLE }
        app.opening.value = null
    }

    // Something shared from another app: a new chat, with it in the message box (the composer takes it from there).
    val shared by app.shared.collectAsState()
    LaunchedEffect(shared != null) {
        if (shared == null) return@LaunchedEffect
        knight = null
        room = null
        keys = false
        connectors = false
        mac = null
        app.chat.fresh()
        place = Place.GALAHAD
        chat = true
    }

    BackHandler(enabled = screen.opened || place != Place.GALAHAD) {
        when {
            chat -> chat = false
            knight != null -> knight = null
            room != null -> room = null
            keys -> keys = false
            connectors -> connectors = false
            mac != null -> mac = null
            else -> place = Place.GALAHAD
        }
    }
    val go = { to: Place ->
        chat = false
        knight = null
        room = null
        keys = false
        connectors = false
        mac = null
        place = to
    }
    val icon: @Composable (Place) -> Unit = { p ->
        when (p) {
            // His orb, in the colour of where he stands, as everywhere he is.
            Place.GALAHAD -> GalahadOrb(26.dp, Orb.tone(table.galahad.state))
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
                    // Material 3 Expressive's own springs: the default spatial one for the slide, its effects one for the fade.
                    val slide = motion.defaultSpatialSpec<IntOffset>()
                    val fade = motion.defaultEffectsSpec<Float>()
                    when {
                        targetState.opened && !initialState.opened -> (slideInHorizontally(slide) { it / 10 } + fadeIn(fade)) togetherWith fadeOut(fade)
                        !targetState.opened && initialState.opened -> fadeIn(fade) togetherWith (slideOutHorizontally(slide) { it / 10 } + fadeOut(fade))
                        else -> fadeIn(fade) togetherWith fadeOut(fade)
                    }
                },
                modifier = Modifier.weight(1f).fillMaxHeight(),
                label = "screen",
            ) { s ->
                // A tap that nothing on the page takes (no field, button or row) puts the keyboard away, as Back does (your
                // word, 23 November 2026: it can always be closed, so you never get stuck under it).
                Column(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures(onTap = { focus.clearFocus() }) }) {
                    when {
                        s.chat -> ChatScreen(app) { chat = false }
                        s.knight != null -> KnightScreen(app, s.knight) { knight = null }
                        s.room != null -> RoomScreen(app, s.room) { room = null }
                        s.keys -> KeysScreen(app) { keys = false }
                        s.connectors -> ConnectorsScreen(app) { connectors = false }
                        s.mac != null -> DesktopScreen(app, s.mac, inbox.screens.firstOrNull { it["node"].string == s.mac }?.let { it["nodeName"].string } ?: "The Mac", onMac = true) { mac = null }
                        s.place == Place.GALAHAD -> GalahadHome(app, openChat = { chat = true }, showInbox = { go(Place.INBOX) })
                        // (Galahad's seat leads to him, as his tab is.)
                        s.place == Place.ROUNDTABLE -> RoundtableScreen(app, openChat = { go(Place.GALAHAD) }, openKnight = { knight = it }, openRoom = { room = it })
                        s.place == Place.INBOX -> InboxScreen(app, watch = { mac = it })
                        else -> MoreScreen(app, openKeys = { keys = true }, openConnectors = { connectors = true })
                    }
                }
            }
        }
    }
}

/** This phone, its node, its keys and connectors, and the way out: forgetting the node here. */
@Composable
private fun MoreScreen(app: AppModel, openKeys: () -> Unit, openConnectors: () -> Unit) {
    val paired by app.paired.collectAsState()
    var forgetting by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: ""
    var newer by remember { mutableStateOf<Updates.Newer?>(null) }
    LaunchedEffect(Unit) { newer = Updates.newer(context) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.margin), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
        Text("More", style = MaterialTheme.typography.headlineLargeEmphasized)
        newer?.let { n ->
            Panel {
                Text("A newer Galahad is out", style = MaterialTheme.typography.titleMediumEmphasized)
                Text("Build ${n.build} (${n.size}). It installs over this one: open it once it's downloaded.", style = MaterialTheme.typography.bodyMedium)
                Button(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(n.url))) }) { Text("Download") }
            }
        }
        NotificationsPanel(app)
        Panel {
            Text("Keys", style = MaterialTheme.typography.titleMediumEmphasized)
            Text("Your providers' and services' keys, sealed for your full nodes: add, replace or delete one. Never shown again, never seen by a model.", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = openKeys) { Text("Open Keys") }
        }
        Panel {
            Text("Connectors", style = MaterialTheme.typography.titleMediumEmphasized)
            Text("The services Galahad reaches for you (mail, calendars, GitHub and more): add one, sign in as yourself or seal its key, and see what it can do.", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = openConnectors) { Text("Open Connectors") }
        }
        paired?.let { p ->
            Panel {
                Text("Your node", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(p.fleetName ?: p.nodeName ?: "Galahad", style = MaterialTheme.typography.titleMediumEmphasized)
                Text(p.origin, style = MaterialTheme.typography.bodyMedium)
            }
            Panel {
                Text("This phone", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(p.name, style = MaterialTheme.typography.titleMediumEmphasized)
                Text("Its key: ${p.device.take(14)}…", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                Text("Kept in this phone's secure hardware; every request is signed with it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Panel {
            Text("Galahad $version", style = MaterialTheme.typography.titleMediumEmphasized)
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
 * Notifications on this phone: on and off, instant or collected, a test, and what Android allows. Collected, the node
 * keeps them and this phone asks for them; instant, they come through a UnifiedPush distributor of your choice (Sunup,
 * ntfy, or another), encrypted to this phone's own key. What he sends and when he stays quiet are the node's settings.
 */
@Composable
private fun NotificationsPanel(app: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(Notices.on(context)) }
    var instant by remember { mutableStateOf(Notices.instant(context)) }
    var trouble by remember { mutableStateOf(Notices.trouble(context)) }
    var allowed by remember { mutableStateOf(Notices.allowed(context)) }
    var said by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // The distributors on this phone, read again while this is on screen (one installed meanwhile is offered at once).
    var distributors by remember { mutableStateOf(UnifiedPush.distributors(context)) }
    // The distributor this phone registered with (it may not have given its address yet): read again with the rest.
    var current by remember { mutableStateOf(UnifiedPush.registration(context)?.distributor) }
    val brand = LocalBrand.current
    // A distributor answers by broadcast: what it said is read again while this is on screen.
    LaunchedEffect(Unit) {
        var tick = 0
        while (true) {
            delay(1_000)
            on = Notices.on(context)
            instant = Notices.instant(context)
            trouble = Notices.trouble(context)
            current = UnifiedPush.registration(context)?.distributor
            if (++tick % 3 == 0) distributors = UnifiedPush.distributors(context)
        }
    }
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
                instant = Notices.instant(context)
                current = UnifiedPush.registration(context)?.distributor
                allowed = Notices.allowed(context)
            }
        }
    }
    // Collected at once; instant as soon as the distributor gives an endpoint, if there is one.
    // (With several distributors, none is chosen for you: you pick one below.)
    suspend fun start(client: NodeClient) {
        Notices.turnOn(context, client)
        distributors.singleOrNull()?.let { Notices.makeInstant(context, client, it) }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = Notices.allowed(context)
        if (granted) act { start(it) } else said = "Android won't show them until notifications are allowed for Galahad."
    }
    Panel {
        Text("Notifications", style = MaterialTheme.typography.titleMediumEmphasized)
        Text(
            when {
                !on -> "Off. Galahad can tell you here when something needs you: an approval, a question, a finding, work that ended."
                instant != null -> "On, and instant: they come through $instant (UnifiedPush), encrypted to this phone, so its push server can't read them."
                else -> "On. This phone collects them from your node about every 15 minutes (Android may wait longer while it sleeps)."
            },
            style = MaterialTheme.typography.bodyMedium,
        )
        val asked = current
        if (on && instant == null && asked != null && trouble == null) {
            Text("Asking ${UnifiedPush.label(context, asked)} for this phone's address: they're collected until it gives one.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (on && instant == null) {
            when (distributors.size) {
                0 -> {
                    Text("For them to arrive at once, install a UnifiedPush distributor such as Sunup (it uses Mozilla's push service, nothing to set up) or ntfy, then come back here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://unifiedpush.org/users/distributors/"))) }) { Text("Find a distributor") }
                }
                1 -> TextButton(enabled = !busy, onClick = { act { Notices.makeInstant(context, it, distributors.single()) } }) { Text("Make them instant, through ${UnifiedPush.label(context, distributors.single())}") }
                else -> {
                    Text("Make them instant, through:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    for (d in distributors) TextButton(enabled = !busy, onClick = { act { Notices.makeInstant(context, it, d) } }) { Text(UnifiedPush.label(context, d)) }
                }
            }
        }
        // Instant through one of several: another may be chosen in its place.
        if (on && instant != null && asked != null) {
            for (d in distributors.filter { it != asked }) {
                TextButton(enabled = !busy, onClick = { act { Notices.switchTo(context, it, d) } }) { Text("Switch to ${UnifiedPush.label(context, d)}") }
            }
        }
        trouble?.let { Text("Not instant: $it", style = MaterialTheme.typography.bodySmall, color = brand.needs) }
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
                        // Collected ones are shown now; an instant one arrives on its own.
                        if (instant == null) Notices.collect(context, client)
                    }
                }) { Text("Send a test") }
                TextButton(enabled = !busy, onClick = { act { Notices.turnOff(context, it) } }) { Text("Turn off") }
            } else {
                Button(enabled = !busy, onClick = {
                    if (Build.VERSION.SDK_INT >= 33 && !Notices.allowed(context)) ask.launch(android.Manifest.permission.POST_NOTIFICATIONS) else act { start(it) }
                }) { Text("Turn on") }
            }
        }
        Text("What he sends, and the hours he stays quiet, are your node's settings: Settings in the web app, or galahad notify.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private val roundtableIcon: ImageVector = roundtableMark(Color.Black, Color.Black)
