package org.amirite.galahad.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.amirite.galahad.app.AppModel

/** Where you are: one of the three places, or a page opened from one (Galahad's chat, a knight's page). */
private enum class Place { ROUNDTABLE, INBOX, MORE }

/**
 * The app once it's paired: the Roundtable, the Inbox and More, as the iPhone's tabs are, with Galahad's chat and each
 * knight's page opened from the Roundtable. Back closes what was opened, then returns to the Roundtable.
 */
@Composable
fun Root(app: AppModel) {
    var place by rememberSaveable { mutableStateOf(Place.ROUNDTABLE) }
    var chat by rememberSaveable { mutableStateOf(false) }
    var knight by rememberSaveable { mutableStateOf<String?>(null) }
    val inbox by app.inbox.collectAsState()

    BackHandler(enabled = chat || knight != null || place != Place.ROUNDTABLE) {
        when {
            chat -> chat = false
            knight != null -> knight = null
            else -> place = Place.ROUNDTABLE
        }
    }

    Scaffold(
        bottomBar = {
            if (!chat && knight == null) {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    NavigationBarItem(selected = place == Place.ROUNDTABLE, onClick = { place = Place.ROUNDTABLE }, icon = { Icon(roundtableIcon, null) }, label = { Text("Roundtable") })
                    NavigationBarItem(
                        selected = place == Place.INBOX,
                        onClick = { place = Place.INBOX },
                        icon = {
                            BadgedBox(badge = { if (inbox.count > 0) Badge(containerColor = LocalBrand.current.siege) { Text(AppModel.badge(inbox.count)) } }) { Icon(trayIcon, null) }
                        },
                        label = { Text("Inbox") },
                    )
                    NavigationBarItem(selected = place == Place.MORE, onClick = { place = Place.MORE }, icon = { Icon(moreIcon, null) }, label = { Text("More") })
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                chat -> ChatScreen(app) { chat = false }
                knight != null -> KnightScreen(app, knight!!) { knight = null }
                place == Place.ROUNDTABLE -> RoundtableScreen(app, openChat = { chat = true }, openKnight = { knight = it })
                place == Place.INBOX -> InboxScreen(app)
                else -> MoreScreen(app)
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
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.margin), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
        Text("More", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
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

/** A tray, for the Inbox. */
private val trayIcon: ImageVector = ImageVector.Builder("Tray", 24.dp, 24.dp, 24f, 24f).apply {
    path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f) {
        moveTo(3.5f, 13f); lineTo(6.5f, 5f); lineTo(17.5f, 5f); lineTo(20.5f, 13f); lineTo(20.5f, 19f); lineTo(3.5f, 19f); close()
        moveTo(3.5f, 13f); lineTo(8.5f, 13f); lineTo(9.5f, 15.5f); lineTo(14.5f, 15.5f); lineTo(15.5f, 13f); lineTo(20.5f, 13f)
    }
}.build()

/** Three dots, for More. */
private val moreIcon: ImageVector = ImageVector.Builder("More", 24.dp, 24.dp, 24f, 24f).apply {
    for (x in listOf(5f, 12f, 19f)) path(fill = SolidColor(Color.Black)) {
        moveTo(x - 1.8f, 12f); arcToRelative(1.8f, 1.8f, 0f, true, true, 3.6f, 0f); arcToRelative(1.8f, 1.8f, 0f, true, true, -3.6f, 0f); close()
    }
}.build()
