package org.amirite.galahad.ui

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.amirite.galahad.core.KnightState
import org.amirite.galahad.core.Orb
import org.amirite.galahad.core.OrbMotion

/**
 * The knights as the owner drew them: the PWA's own WebP files, packaged as they are (never redrawn or recoloured), read
 * once each and kept. The @2x drawing for a face of 120 dp or more, as the Apple app does.
 */
object Drawings {
    private val kept = java.util.concurrent.ConcurrentHashMap<String, ImageBitmap>()

    // (Read without a lock: a face being drawn never waits on another being read. Two that read the same one keep one.)
    fun of(context: Context, name: String): ImageBitmap? = kept[name] ?: runCatching {
        context.assets.open("$name.webp").use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
    }.getOrNull()?.let { kept.putIfAbsent(name, it) ?: it }

    /**
     * Every face the Roundtable draws, read before it's drawn: off the main thread as the app starts (about 330 KB each
     * once read). The large drawings, for a face of 120 dp or more, are read when one is drawn.
     */
    fun prewarm(context: Context) {
        for (file in context.assets.list("").orEmpty()) if (file.endsWith(".webp") && "@2x" !in file) of(context, file.removeSuffix(".webp"))
    }
}

private val paused = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.15f) })

/**
 * A face in its state's ring. A paused knight is drawn faded (saturation 0.15, opacity 0.62, as the Apple app draws
 * it). [drawing] is the look's name (`gareth`), `galahad`, or `black-knight`; [key] is whose face it is (a knight's
 * handle; its look's name when left out), which seeds its lights. Round the ring its state's lights move (the PWA's
 * seatLights; your word, 24 November 2026: "pulsing/moving when doing a task, sitting idle, waiting, done"): a light runs
 * round it at work, it beats and sends out waves while it needs you, it bursts when work is done, its motes run down
 * when work failed. They are drawn outside the ring's inner edge only: the drawing itself is never moved, covered or
 * recoloured. Galahad himself is his orb (your word, 23 November 2026), in the colour and the mood of where he stands,
 * as his ring's would be.
 */
@Composable
fun Face(drawing: String, state: KnightState?, size: Dp = Space.rowFace, description: String? = null, key: String? = null) {
    if (drawing == "galahad") return GalahadOrb(size, Orb.tone(state), description, mood = OrbMotion.mood(state))
    val context = LocalContext.current
    val brand = LocalBrand.current
    val name = if (size >= 120.dp && drawing == "black-knight") "$drawing@2x" else drawing
    val image = remember(name) { Drawings.of(context, name) }
    val ring = state?.tone?.let(brand::of)
    Box(contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(brand.raised)
                .then(if (ring != null) Modifier.border(Space.ring, ring, CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (image != null) {
                Image(
                    bitmap = image,
                    contentDescription = description,
                    contentScale = ContentScale.Crop,
                    colorFilter = if (state == KnightState.PAUSED) paused else null,
                    modifier = Modifier
                        .padding(if (ring != null) Space.ring + 1.dp else 0.dp)
                        .clip(CircleShape)
                        .alpha(if (state == KnightState.PAUSED) 0.62f else 1f),
                )
            }
        }
        // (Over the face, unclipped by it, as large: its lights reach past it without moving anything round it.)
        SeatLights(size, state, key ?: drawing)
    }
}

/**
 * A seat's lights, in the units of the PWA's "ring" stage (100 is the ring's outer edge): the ring's glow breathing (a
 * bloom, then a closer glow), its waves, the light running round it and its motes, in its state's colour. Nothing while
 * the phone's animations are off: the still ring says the state then, as it always has.
 */
@Composable
private fun SeatLights(size: Dp, state: KnightState?, key: String) {
    if (!motionAllowed()) return
    val mood = OrbMotion.mood(state)
    val palette = Orb.palette(Orb.tone(state))
    val seed = remember(key) { OrbMotion.seed(key) }
    val course = remember(key, mood) { Courses.keep("seat:$key", mood, seed) }
    // As often as its mood needs: 30 a second at work or arriving at a mood, else 15.
    val time = frameTime { OrbMotion.fps(course.mood, "ring", Courses.since(course)) }
    Canvas(Modifier.size(size)) {
        val frame = Courses.advance(course, time.doubleValue, seed)
        val k = this.size.width / 200f
        // The ring, as wide as the one the face is drawn in; at rest, where it would be.
        val width = Space.ring.toPx() / k.toDouble()
        val r = 100 - width / 2
        withTransform({
            translate(this@Canvas.size.width / 2, this@Canvas.size.height / 2)
            scale(k, k, pivot = Offset.Zero)
        }) {
            // Only outside the ring's inner edge: nothing of it falls on the drawing.
            clipPath(Path().apply { addOval(Rect(Offset.Zero, (100 - width).toFloat())) }, clipOp = ClipOp.Difference) {
                val glow = frame.aura
                if (glow > 0.005) {
                    ringAt(r, width * 6, Color(0xff000000 or palette.tint).copy(alpha = (glow * 0.28).toFloat()))
                    ringAt(r, width * 2.6, Color(0xff000000 or palette.tint).copy(alpha = (glow * 0.6).toFloat()))
                }
                waves(frame, OrbMotion.RING, palette)
                frame.comet?.let { comet(it, r, maxOf(width * 1.6, 3.0), palette) }
                motes(OrbMotion.shownMotes(frame, OrbMotion.RING), OrbMotion.RING, palette)
            }
        }
    }
}
