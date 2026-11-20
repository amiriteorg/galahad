package org.amirite.galahad.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.amirite.galahad.core.KnightState

/** A state in a word, in its colour: a still chip, never an animation. None for a knight at rest. */
@Composable
fun StateChip(state: KnightState?) {
    val words = state?.words ?: return
    val color = LocalBrand.current.of(state.tone) ?: MaterialTheme.colorScheme.onSurfaceVariant
    Text(
        words,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** A still dot: something new to you here, or work under way where a spinner would have turned. */
@Composable
fun Dot(color: Color, size: Int = 8) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(color))
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(horizontal = Space.margin, vertical = Space.s2).semantics { heading() },
    )
}

/**
 * A page's bar (Material's top app bar): back to where it opened from, what it is, and what it offers. The page already
 * sits below the status bar, so the bar adds no inset of its own.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PageBar(title: String, back: () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = back) { Icon(BackIcon, contentDescription = "Back") } },
        actions = actions,
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

/** A raised card, as the Inbox's cards are. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Space.margin, vertical = Space.s1)
            .clip(MaterialTheme.shapes.large)
            .background(LocalBrand.current.raised)
            .padding(Space.s4),
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) { content() }
}

/** What the node said went wrong, in its words, where it shows. */
@Composable
fun Problem(text: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.margin, vertical = Space.s1)
            .clip(MaterialTheme.shapes.medium)
            .background(LocalBrand.current.needs.copy(alpha = 0.12f))
            .padding(Space.s3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Dot(LocalBrand.current.needs)
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

/** The Roundtable mark (apps/web/src/brand.ts roundtableIcon): five seats, and the Siege Perilous in red. */
fun roundtableMark(ink: Color, siege: Color): ImageVector = ImageVector.Builder("Roundtable", 24.dp, 24.dp, 24f, 24f).apply {
    // The table: a ring of radius 5.25, stroked 1.5 wide.
    path(stroke = androidx.compose.ui.graphics.SolidColor(ink), strokeLineWidth = 1.5f) {
        moveTo(6.75f, 12f)
        arcToRelative(5.25f, 5.25f, 0f, true, false, 10.5f, 0f)
        arcToRelative(5.25f, 5.25f, 0f, true, false, -10.5f, 0f)
    }
    // The five seats, each a stadium at the foot turned round the table's centre.
    for (degrees in listOf(240f, 300f, 0f, 60f, 120f)) {
        val r = Math.toRadians(degrees.toDouble())
        val (c, s) = Math.cos(r).toFloat() to Math.sin(r).toFloat()
        fun x(px: Float, py: Float) = 12f + (px - 12f) * c - (py - 12f) * s
        fun y(px: Float, py: Float) = 12f + (px - 12f) * s + (py - 12f) * c
        path(fill = androidx.compose.ui.graphics.SolidColor(ink)) {
            // A seat as a polygon round its stadium (fine at icon sizes): the ends rounded by short chords.
            val pts = listOf(11f to 20f, 13f to 20f, 13.7f to 20.3f, 14f to 21f, 13.7f to 21.7f, 13f to 22f, 11f to 22f, 10.3f to 21.7f, 10f to 21f, 10.3f to 20.3f)
            pts.forEachIndexed { i, (px, py) -> if (i == 0) moveTo(x(px, py), y(px, py)) else lineTo(x(px, py), y(px, py)) }
            close()
        }
    }
    // The Siege Perilous, Galahad's seat, at the head of the table.
    path(fill = androidx.compose.ui.graphics.SolidColor(siege)) {
        moveTo(11f, 1f); lineTo(13f, 1f); arcToRelative(1f, 1f, 0f, false, true, 1f, 1f); lineTo(14f, 3f)
        arcToRelative(1f, 1f, 0f, false, true, -1f, 1f); lineTo(11f, 4f); arcToRelative(1f, 1f, 0f, false, true, -1f, -1f); lineTo(10f, 2f)
        arcToRelative(1f, 1f, 0f, false, true, 1f, -1f); close()
    }
}.build()
