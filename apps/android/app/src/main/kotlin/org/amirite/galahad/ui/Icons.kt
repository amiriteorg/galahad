package org.amirite.galahad.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.group
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/*
 * The app's few icons, drawn here (no icon library): 24 dp, one stroke 1.8 wide, tinted by where they're used. The
 * Roundtable mark is the brand's own (Parts.kt).
 */

private fun icon(name: String, mirrored: Boolean = false, draw: ImageVector.Builder.() -> Unit): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f, autoMirror = mirrored).apply(draw).build()

private fun ImageVector.Builder.line(draw: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit) =
    path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round, pathBuilder = draw)

/** Back: an arrow to the start (mirrored where text runs right to left). */
val BackIcon: ImageVector = icon("Back", mirrored = true) {
    line { moveTo(19f, 12f); lineTo(5f, 12f); moveTo(11f, 6f); lineTo(5f, 12f); lineTo(11f, 18f) }
}

/** Remove: a cross. */
val CloseIcon: ImageVector = icon("Close") {
    line { moveTo(6.5f, 6.5f); lineTo(17.5f, 17.5f); moveTo(17.5f, 6.5f); lineTo(6.5f, 17.5f) }
}

/** A file carried by a message: a paperclip, three loops, at a slant. */
val AttachIcon: ImageVector = icon("Attach") {
    group(rotate = 40f, pivotX = 12f, pivotY = 12f) {
        line {
            moveTo(15.75f, 9f); lineTo(15.75f, 15.5f)
            arcTo(3.5f, 3.5f, 0f, false, true, 8.75f, 15.5f)
            lineTo(8.75f, 6f)
            arcTo(2.5f, 2.5f, 0f, false, true, 13.75f, 6f)
            lineTo(13.75f, 15f)
            arcTo(1.25f, 1.25f, 0f, false, true, 11.25f, 15f)
            lineTo(11.25f, 8.5f)
        }
    }
}

/** A step done: a check. */
val CheckIcon: ImageVector = icon("Done") {
    line { moveTo(5f, 12.5f); lineTo(10f, 17.5f); lineTo(19f, 7f) }
}

/** A step skipped: a dash. */
val DashIcon: ImageVector = icon("Skipped") {
    line { moveTo(7f, 12f); lineTo(17f, 12f) }
}

/** A step still to do: an empty ring. */
val RingIcon: ImageVector = icon("To do") {
    line { moveTo(6f, 12f); arcToRelative(6f, 6f, 0f, true, true, 12f, 0f); arcToRelative(6f, 6f, 0f, true, true, -12f, 0f); close() }
}

/** A step being done: a filled dot. */
val DotIcon: ImageVector = icon("Doing") {
    path(fill = SolidColor(Color.Black)) { moveTo(7.5f, 12f); arcToRelative(4.5f, 4.5f, 0f, true, true, 9f, 0f); arcToRelative(4.5f, 4.5f, 0f, true, true, -9f, 0f); close() }
}

/** A tray, for the Inbox. */
val TrayIcon: ImageVector = icon("Tray") {
    path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f) {
        moveTo(3.5f, 13f); lineTo(6.5f, 5f); lineTo(17.5f, 5f); lineTo(20.5f, 13f); lineTo(20.5f, 19f); lineTo(3.5f, 19f); close()
        moveTo(3.5f, 13f); lineTo(8.5f, 13f); lineTo(9.5f, 15.5f); lineTo(14.5f, 15.5f); lineTo(15.5f, 13f); lineTo(20.5f, 13f)
    }
}

/** Three dots, for More. */
val MoreIcon: ImageVector = icon("More") {
    for (x in listOf(5f, 12f, 19f)) path(fill = SolidColor(Color.Black)) {
        moveTo(x - 1.8f, 12f); arcToRelative(1.8f, 1.8f, 0f, true, true, 3.6f, 0f); arcToRelative(1.8f, 1.8f, 0f, true, true, -3.6f, 0f); close()
    }
}

/** Add one: a plus. */
val PlusIcon: ImageVector = icon("Add") {
    line { moveTo(12f, 5f); lineTo(12f, 19f); moveTo(5f, 12f); lineTo(19f, 12f) }
}
