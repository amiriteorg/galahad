package org.amirite.galahad.ui

import android.content.Context
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.RadialGradient
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DoubleState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import org.amirite.galahad.core.Orb
import org.amirite.galahad.core.OrbMotion
import kotlinx.coroutines.delay
import java.util.IdentityHashMap
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * Galahad as an orb (the PWA's ui/orb.ts, the Apple app's GalahadOrb): Orb's parts for its size, in the colour of his
 * state, the same in light and dark. Given a [mood] (OrbMotion; your word, 24 November 2026: "pulsing/moving when doing
 * a task, sitting idle, waiting, done"), it moves as that mood does, a frame at a time, its motes and waves reaching out
 * past it over what is round it, which they never move or take a tap from. Without one, and while the phone's
 * animations are off, it is the same parts, still. Decorative beside his name; named ([description]) where it stands
 * alone. [key] says which orb it is, so one drawn again (a new state, a screen shown again) carries on where it was and
 * a change of mood fades or bursts: his own when left out, so all his orbs move as one.
 */
@Composable
fun GalahadOrb(size: Dp, tone: Orb.Tone = Orb.Tone.NEUTRAL, description: String? = null, mood: OrbMotion.Mood? = null, key: String = "galahad") {
    val parts = Orb.parts(size.value.toDouble())
    val palette = Orb.palette(tone)
    val level = Orb.level(size.value.toDouble())
    val stage = OrbMotion.stage(level)
    val seed = if (key == "galahad") 0L else OrbMotion.seed(key)
    val course = remember(key, mood) { mood?.let { Courses.keep(key, it, seed) } }
    // As often as its mood needs (OrbMotion.fps): fast at work or arriving, slow otherwise, his home's twice as often.
    val time = if (course != null && motionAllowed()) frameTime { OrbMotion.fps(course.mood, level.wire, Courses.since(course)) } else null
    Canvas(Modifier.size(size).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        val frame = if (course != null && time != null) Courses.advance(course, time.doubleValue, seed) else OrbMotion.STILL
        val scale = this.size.width / 200f
        withTransform({
            translate(this@Canvas.size.width / 2, this@Canvas.size.height / 2)
            scale(scale, scale, pivot = Offset.Zero)
        }) {
            paint(parts, palette, frame, stage)
        }
    }
}

// ---- each orb's own course, kept by its key: its mood, the one before, when it changed, and its clock --------------

/** Now, in seconds, on the clock the frames are timed by (Choreographer's, System.nanoTime's). */
internal fun now(): Double = System.nanoTime() / 1e9

/**
 * Each orb's course, by its key (the PWA's keep and advance): begun settled on first sight; on a new mood, the change
 * starts then, so its motes fade or burst and its rings ease to their new pace. Kept for the app's life: a few per
 * knight. Touched only on the main thread, where composing and drawing are.
 */
internal object Courses {
    class Course(var mood: OrbMotion.Mood, var from: OrbMotion.Mood?, var at: Double, var burst: Boolean, var clock: OrbMotion.Clock, var last: Double)

    private val kept = HashMap<String, Course>()

    fun keep(key: String, mood: OrbMotion.Mood, seed: Long): Course {
        val course = kept[key] ?: return Course(mood, null, Double.NEGATIVE_INFINITY, false, OrbMotion.clock(mood, seed), now()).also { kept[key] = it }
        if (course.mood != mood) {
            course.from = course.mood
            course.burst = OrbMotion.bursts(course.mood, mood)
            course.mood = mood
            course.at = now()
        }
        return course
    }

    /** Its frame at [t], its clock stepped on to it first (once a moment, however many of its orbs are drawn). */
    fun advance(course: Course, t: Double, seed: Long): OrbMotion.Frame {
        if (t > course.last) {
            course.clock = OrbMotion.step(course.clock, course.mood, t - course.last)
            course.last = t
        }
        val since = if (course.at.isFinite()) t - course.at else null
        return OrbMotion.frame(course.mood, course.clock, t, seed, since, course.from, course.burst)
    }

    /** Seconds since it arrived at its mood; null, on first sight (settled). */
    fun since(course: Course): Double? = if (course.at.isFinite()) now() - course.at else null
}

/**
 * The time of the frame it is drawn at, in seconds, [fps] times a second (asked again after each frame, as its mood can
 * change): read only while drawing, so a new one draws it again and composes nothing. Between two it sleeps, asking for
 * no frame at all, until just before the next is due: the screen's other frames aren't woken for it.
 */
@Composable
internal fun frameTime(fps: () -> Int): DoubleState {
    val time = remember { mutableDoubleStateOf(now()) }
    val rate = rememberUpdatedState(fps)
    LaunchedEffect(Unit) {
        while (true) {
            withFrameNanos { nanos -> time.doubleValue = nanos / 1e9 }
            // (Woken 10 ms early, the frame after is the one due, on a screen refreshing 60 or 120 times a second.)
            delay(maxOf(0L, 1000L / rate.value().coerceAtLeast(1) - 10L))
        }
    }
    return time
}

/** Whether things may move: not while the phone's animations are off (Settings › Accessibility › Remove animations,
 * which sets the animator duration scale to 0). Read once, then watched for the app's life. */
@Composable
internal fun motionAllowed(): Boolean {
    val context = LocalContext.current
    return remember(context) { MotionSetting.allowed(context) }.value
}

private object MotionSetting {
    private var state: MutableState<Boolean>? = null

    fun allowed(context: Context): State<Boolean> = state ?: run {
        val app = context.applicationContext ?: context
        val watched = mutableStateOf(on(app))
        app.contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) {
                    watched.value = on(app)
                }
            },
        )
        state = watched
        watched
    }

    private fun on(context: Context) = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
}

// ---- drawing, in the orb's square (200 wide, its middle at 0, y down) ---------------------------------------------

private fun Orb.Palette.color(ink: Orb.Ink, opacity: Double): Color = when (ink) {
    Orb.Ink.TINT -> Color(0xff000000 or tint)
    Orb.Ink.LIGHT -> Color(0xff000000 or light)
    Orb.Ink.DEEP -> Color(0xff000000 or deep)
    Orb.Ink.WHITE -> Color.White
}.copy(alpha = opacity.coerceIn(0.0, 1.0).toFloat())

/** The point `r` from the middle at `angle` degrees clockwise from the top (y down). */
private fun point(r: Double, angle: Double): Offset {
    val radians = Math.toRadians(angle)
    return Offset((r * sin(radians)).toFloat(), (-r * cos(radians)).toFloat())
}

/** The orb's parts as a frame moves them, with its lights among them (OrbMotion.Moves): the still orb for STILL. */
private fun DrawScope.paint(parts: List<Orb.Part>, palette: Orb.Palette, frame: OrbMotion.Frame, stage: OrbMotion.Stage) {
    if (parts.none { it.name == "halo" }) waves(frame, stage, palette)
    for (part in parts) {
        if (part.name == OrbMotion.Moves.LIGHTS_BEFORE) {
            val light = frame.comet
            val ring = stage.comet
            if (light != null && ring != null) comet(light, ring.r, ring.width, palette)
            motes(OrbMotion.shownMotes(frame, stage), stage, palette)
        }
        val turn = when (part.name) {
            in OrbMotion.Moves.ring -> frame.ring
            in OrbMotion.Moves.ticks -> frame.ticks
            in OrbMotion.Moves.segments -> frame.segments
            else -> 0.0
        }
        val swell = if (part.name in OrbMotion.Moves.swell) frame.scale else 1.0
        val glow = if (part.name in OrbMotion.Moves.glow) frame.glow else 1.0
        if (turn == 0.0 && swell == 1.0) draw(part, palette, glow)
        else withTransform({
            if (turn != 0.0) rotate(turn.toFloat(), pivot = Offset.Zero)
            if (swell != 1.0) scale(swell.toFloat(), swell.toFloat(), pivot = Offset.Zero)
        }) { draw(part, palette, glow) }
        if (part.name == "halo") waves(frame, stage, palette)
    }
}

/**
 * What a part is drawn with, made once and kept for the app's life (the PWA makes each part's path and gradient once, as
 * well): a ring's or a tick's stroke and a ticks' path by the part (each level's parts are the same objects every
 * time), and a gradient by its palette and part. Only a glow that breathes (the halo, the core) is made afresh, for a
 * frame. Touched only on the main thread, where drawing is.
 */
private object Kit {
    private val strokes = IdentityHashMap<Orb.Part, Stroke>()
    private val paths = IdentityHashMap<Orb.Part.Ticks, Path>()
    private val brushes = HashMap<Long, IdentityHashMap<Orb.Part, Brush>>()

    fun stroke(part: Orb.Part, width: Double): Stroke = strokes.getOrPut(part) { Stroke(width = width.toFloat(), cap = StrokeCap.Butt) }

    fun path(part: Orb.Part.Ticks): Path = paths.getOrPut(part) {
        Path().apply {
            for (i in 0 until part.count) {
                val angle = part.offset + 360.0 * i / part.count
                val from = point(part.r - part.length / 2, angle)
                val to = point(part.r + part.length / 2, angle)
                moveTo(from.x, from.y)
                lineTo(to.x, to.y)
            }
        }
    }

    /** A disc's or a rim's gradient in a palette, its stops brightened by [glow] (no more than opaque): kept when unglowed. */
    fun brush(part: Orb.Part, palette: Orb.Palette, glow: Double): Brush {
        if (glow != 1.0) return made(part, palette, glow)
        return brushes.getOrPut(palette.tint) { IdentityHashMap() }.getOrPut(part) { made(part, palette, 1.0) }
    }

    private fun made(part: Orb.Part, palette: Orb.Palette, glow: Double): Brush {
        fun stops(list: List<Orb.Stop>) = list.map { it.at.toFloat() to palette.color(it.ink, minOf(1.0, it.opacity * glow)) }.toTypedArray()
        return when (part) {
            // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
            is Orb.Part.Disc -> {
                val r = part.r.toFloat()
                Brush.radialGradient(*stops(part.stops), center = Offset(-r + part.cx.toFloat() * 2 * r, -r + part.cy.toFloat() * 2 * r), radius = part.spread.toFloat() * 2 * r)
            }
            is Orb.Part.Rim -> Brush.linearGradient(*stops(part.stops), start = Offset(part.fromX.toFloat(), part.fromY.toFloat()), end = Offset(part.toX.toFloat(), part.toY.toFloat()))
            else -> error("no gradient for ${part.name}")
        }
    }
}

/** One part, as the PWA's SVG has it; a gradient's stops brightened by [glow] (no more than opaque). */
private fun DrawScope.draw(part: Orb.Part, palette: Orb.Palette, glow: Double) {
    when (part) {
        is Orb.Part.Disc -> drawCircle(Kit.brush(part, palette, glow), radius = part.r.toFloat(), center = Offset.Zero)
        is Orb.Part.Ring -> {
            val r = part.r.toFloat()
            val color = palette.color(part.ink, part.opacity)
            val stroke = Kit.stroke(part, part.width)
            val arcs = part.arcs
            if (arcs == null) {
                drawCircle(color, radius = r, center = Offset.Zero, style = stroke)
            } else {
                // (Degrees from the top, clockwise: a canvas's own start at three o'clock, y down.)
                for (arc in arcs) drawArc(color, (arc.from - 90).toFloat(), (arc.to - arc.from).toFloat(), useCenter = false, topLeft = Offset(-r, -r), size = Size(2 * r, 2 * r), style = stroke)
            }
        }
        is Orb.Part.Ticks -> drawPath(Kit.path(part), palette.color(part.ink, part.opacity), style = Kit.stroke(part, part.width))
        is Orb.Part.Rim -> drawCircle(Kit.brush(part, palette, glow), radius = part.r.toFloat(), center = Offset.Zero, style = Kit.stroke(part, part.width))
        is Orb.Part.Shine -> {
            val center = Offset(part.cx.toFloat(), part.cy.toFloat())
            rotate(part.rotate.toFloat(), pivot = center) {
                drawOval(Color.White.copy(alpha = part.opacity.toFloat()), topLeft = Offset(center.x - part.rx.toFloat(), center.y - part.ry.toFloat()), size = Size(2 * part.rx.toFloat(), 2 * part.ry.toFloat()))
            }
        }
    }
}

/** A whole ring of [color], [width] wide, round the middle at [r]. */
internal fun DrawScope.ringAt(r: Double, width: Double, color: Color) {
    drawCircle(color, radius = r.toFloat(), center = Offset.Zero, style = Stroke(width = width.toFloat()))
}

/** Its waves: rings of its light going out from its edge, thinning and fading as they go. */
internal fun DrawScope.waves(frame: OrbMotion.Frame, stage: OrbMotion.Stage, palette: Orb.Palette) {
    for (gone in frame.ripples) ringAt(stage.wavesFrom + gone * (stage.wavesTo - stage.wavesFrom), stage.wave * (1 - 0.6 * gone), palette.color(Orb.Ink.TINT, 0.6 * (1 - gone).pow(2)))
}

/** Its light: a head of white running round [r], its tail in the lit tint, fading and thinning behind it. */
private const val TAIL_STEPS = 18

internal fun DrawScope.comet(light: OrbMotion.Light, r: Double, width: Double, palette: Orb.Palette) {
    val box = Size((2 * r).toFloat(), (2 * r).toFloat())
    val topLeft = Offset(-r.toFloat(), -r.toFloat())
    for (j in 0 until TAIL_STEPS) {
        val along = (j + 1).toDouble() / TAIL_STEPS
        val from = light.head - light.tail + j * light.tail / TAIL_STEPS
        drawArc(
            palette.color(Orb.Ink.LIGHT, light.alpha * along.pow(1.6)),
            (from - 90).toFloat(),
            (light.tail / TAIL_STEPS).toFloat(),
            useCenter = false,
            topLeft = topLeft,
            size = box,
            style = Stroke(width = (width * (0.35 + 0.65 * along)).toFloat(), cap = StrokeCap.Round),
        )
    }
    glowAt(point(r, light.head), width * 2.2, light.alpha, palette)
}

/** Its motes, each a point of light with a glow round it, where the frame puts them in the stage's band. */
internal fun DrawScope.motes(shown: List<OrbMotion.Mote>, stage: OrbMotion.Stage, palette: Orb.Palette) {
    for (mote in shown) {
        if (mote.alpha <= 0.01) continue
        glowAt(point(stage.bandFrom + mote.u * (stage.bandTo - stage.bandFrom), mote.angle), stage.mote * mote.size * 2, mote.alpha, palette)
    }
}

/** A point of light [reach] round [center], as opaque as [alpha]: the palette's sprite, scaled to it. */
private fun DrawScope.glowAt(center: Offset, reach: Double, alpha: Double, palette: Orb.Palette) {
    val sprite = Sprites.of(palette)
    val k = (2 * reach / Sprites.SIZE).toFloat()
    withTransform({
        translate(center.x - reach.toFloat(), center.y - reach.toFloat())
        scale(k, k, pivot = Offset.Zero)
    }) { drawImage(sprite, alpha = alpha.coerceIn(0.0, 1.0).toFloat()) }
}

/** A point of light in a palette, drawn once (the PWA's sprite): white at its heart, its lit tint, then its glow fading
 * to nothing. One per palette, for the app's life. */
private object Sprites {
    const val SIZE = 64
    private val made = HashMap<Long, ImageBitmap>()

    fun of(palette: Orb.Palette): ImageBitmap = made.getOrPut(palette.tint) {
        val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val half = SIZE / 2f
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                half, half, half,
                intArrayOf(argb(0xffffff, 1.0), argb(palette.light, 0.95), argb(palette.tint, 0.4), argb(palette.tint, 0.0)),
                floatArrayOf(0f, 0.18f, 0.45f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        android.graphics.Canvas(bitmap).drawRect(0f, 0f, SIZE.toFloat(), SIZE.toFloat(), paint)
        bitmap.asImageBitmap()
    }

    private fun argb(rgb: Long, alpha: Double): Int = (Math.round(alpha * 255).toInt() shl 24) or (rgb.toInt() and 0xffffff)
}
