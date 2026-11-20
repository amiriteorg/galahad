package org.amirite.galahad.ui

import android.content.Intent
import android.net.Uri
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
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.app.Updates

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

private val roundtableIcon: ImageVector = roundtableMark(Color.Black, Color.Black)
