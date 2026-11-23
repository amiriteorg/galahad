package org.amirite.galahad.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import org.amirite.galahad.core.Orb
import kotlin.math.cos
import kotlin.math.sin

/**
 * Galahad as an orb (the PWA's ui/orb.ts, the Apple app's GalahadOrb): Orb's parts for its size, drawn in the colour of
 * his state, the same in light and dark. Still: a new state is a new colour. Decorative beside his name; named
 * ([description]) where it stands alone.
 */
@Composable
fun GalahadOrb(size: Dp, tone: Orb.Tone = Orb.Tone.NEUTRAL, description: String? = null) {
    val parts = Orb.parts(size.value.toDouble())
    val palette = Orb.palette(tone)
    Canvas(Modifier.size(size).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        val scale = this.size.width / 200f
        withTransform({
            translate(this@Canvas.size.width / 2, this@Canvas.size.height / 2)
            scale(scale, scale, pivot = Offset.Zero)
        }) {
            for (part in parts) draw(part, palette)
        }
    }
}

private fun Orb.Palette.color(ink: Orb.Ink, opacity: Double): Color = when (ink) {
    Orb.Ink.TINT -> Color(0xff000000 or tint)
    Orb.Ink.LIGHT -> Color(0xff000000 or light)
    Orb.Ink.DEEP -> Color(0xff000000 or deep)
    Orb.Ink.WHITE -> Color.White
}.copy(alpha = opacity.toFloat())

/** The point `r` from the middle at `angle` degrees clockwise from the top (y down). */
private fun point(r: Double, angle: Double): Offset {
    val radians = Math.toRadians(angle)
    return Offset((r * sin(radians)).toFloat(), (-r * cos(radians)).toFloat())
}

private fun DrawScope.draw(part: Orb.Part, palette: Orb.Palette) {
    fun stops(list: List<Orb.Stop>) = list.map { it.at.toFloat() to palette.color(it.ink, it.opacity) }.toTypedArray()
    when (part) {
        is Orb.Part.Disc -> {
            // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
            val r = part.r.toFloat()
            val center = Offset(-r + part.cx.toFloat() * 2 * r, -r + part.cy.toFloat() * 2 * r)
            drawCircle(Brush.radialGradient(*stops(part.stops), center = center, radius = part.spread.toFloat() * 2 * r), radius = r, center = Offset.Zero)
        }
        is Orb.Part.Ring -> {
            val r = part.r.toFloat()
            val color = palette.color(part.ink, part.opacity)
            val stroke = Stroke(width = part.width.toFloat(), cap = StrokeCap.Butt)
            val arcs = part.arcs
            if (arcs == null) {
                drawCircle(color, radius = r, center = Offset.Zero, style = stroke)
            } else {
                // (Degrees from the top, clockwise: a canvas's own start at three o'clock, y down.)
                for (arc in arcs) drawArc(color, (arc.from - 90).toFloat(), (arc.to - arc.from).toFloat(), useCenter = false, topLeft = Offset(-r, -r), size = Size(2 * r, 2 * r), style = stroke)
            }
        }
        is Orb.Part.Ticks -> {
            val path = Path()
            for (i in 0 until part.count) {
                val angle = part.offset + 360.0 * i / part.count
                val from = point(part.r - part.length / 2, angle)
                val to = point(part.r + part.length / 2, angle)
                path.moveTo(from.x, from.y)
                path.lineTo(to.x, to.y)
            }
            drawPath(path, palette.color(part.ink, part.opacity), style = Stroke(width = part.width.toFloat(), cap = StrokeCap.Butt))
        }
        is Orb.Part.Rim -> {
            val brush = Brush.linearGradient(*stops(part.stops), start = Offset(part.fromX.toFloat(), part.fromY.toFloat()), end = Offset(part.toX.toFloat(), part.toY.toFloat()))
            drawCircle(brush, radius = part.r.toFloat(), center = Offset.Zero, style = Stroke(width = part.width.toFloat()))
        }
        is Orb.Part.Shine -> {
            val center = Offset(part.cx.toFloat(), part.cy.toFloat())
            rotate(part.rotate.toFloat(), pivot = center) {
                drawOval(Color.White.copy(alpha = part.opacity.toFloat()), topLeft = Offset(center.x - part.rx.toFloat(), center.y - part.ry.toFloat()), size = Size(2 * part.rx.toFloat(), 2 * part.ry.toFloat()))
            }
        }
    }
}
