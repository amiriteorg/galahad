package org.amirite.galahad.ui

import android.content.Context
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.LongSparseArray
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
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.delay
import org.amirite.galahad.core.Avatar
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.Orb
import org.amirite.galahad.core.OrbMotion
import org.amirite.galahad.core.OrbSphere
import java.util.IdentityHashMap
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Galahad as an orb (the PWA's ui/orb.ts, the Apple app's GalahadOrb): Orb's parts for its size, in the colour of his
 * state, his sphere of glyphs round its bright nucleus among them, and on the largest his ring of data. Given a [mood]
 * (OrbMotion; your word, 24 November 2026: "pulsing/moving when doing a task, sitting idle, waiting, done"), it moves as
 * that mood does, a frame at a time, its sphere turning and its glyphs changing on their slow beats, its motes and waves
 * reaching out past it over what is round it, which they never move or take a tap from. Without one, and while the
 * phone's animations are off, it is the same parts, still: one frame. On a light page his glyphs are ink on paper and
 * his white heart is his deep tint. Decorative beside his name; named ([description]) where it stands alone. [key] says
 * which orb it is, so one drawn again (a new state, a screen shown again) carries on where it was and a change of mood
 * fades or bursts: his own when left out, so all his orbs move as one.
 */
@Composable
fun GalahadOrb(size: Dp, tone: Orb.Tone = Orb.Tone.NEUTRAL, description: String? = null, mood: OrbMotion.Mood? = null, key: String = "galahad") {
    val parts = Orb.parts(size.value.toDouble())
    val palette = Orb.palette(tone)
    val level = Orb.level(size.value.toDouble())
    val stage = OrbMotion.stage(level)
    val seed = if (key == "galahad") 0L else OrbMotion.seed(key)
    val paper = onPaper()
    val course = remember(key, mood) { mood?.let { Courses.keep(key, it, seed) } }
    // As often as its mood needs (OrbMotion.fps): fast at work or arriving, slow otherwise, his home's twice as often.
    val time = if (course != null && motionAllowed()) frameTime { OrbMotion.fps(course.mood, level.wire, Courses.since(course)) } else null
    Canvas(Modifier.size(size).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        val t = if (course != null && time != null) time.doubleValue else null
        val frame = if (course != null && t != null) Courses.advance(course, t, seed) else OrbMotion.STILL
        val k = this.size.width / 200f
        // Still, it is its rest: its glyphs as they are at 0, idle.
        val moment = Moment(t ?: 0.0, if (course != null && t != null) course.mood else OrbMotion.Mood.IDLE, paper, k)
        withTransform({
            translate(this@Canvas.size.width / 2, this@Canvas.size.height / 2)
            scale(k, k, pivot = Offset.Zero)
        }) {
            paint(parts, palette, frame, stage, moment)
        }
    }
}

/**
 * A knight's face (the PWA's knightFace): its sphere of glyphs round a bright nucleus, in its own colours (Avatar's
 * knightColors: the one you chose for it, or its handle's), in the light it sits in, with an arc or two of its own turning
 * round it from a card's size (your words, 25 November 2026: "custom/procedurally generated colored particle orbs",
 * "glyph and randomness … like Jarvis/Ultron", "slow and calming movement"). Its sphere and arcs are its handle's
 * (OrbSphere), the same on every device. In a [mood] it turns and breathes on the course [key] names; still, and while
 * the phone's animations are off, it is drawn once. On a light page its glyphs are ink on paper round a deep heart.
 */
@Composable
fun KnightOrb(id: String, profile: Json?, size: Dp, mood: OrbMotion.Mood? = null, description: String? = null, key: String = "face:$id") {
    val level = Orb.level(size.value.toDouble())
    val look = remember(id, profile, level) { KnightLook(id, profile, level) }
    val paper = onPaper()
    val course = remember(key, mood) { mood?.let { Courses.keep(key, it, look.seed) } }
    val time = if (course != null && motionAllowed()) frameTime { OrbMotion.fps(course.mood, level.wire, Courses.since(course)) } else null
    Canvas(Modifier.size(size).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        val t = if (course != null && time != null) time.doubleValue else null
        val frame = if (course != null && t != null) Courses.advance(course, t, look.seed) else OrbMotion.STILL
        val k = this.size.width / 200f
        withTransform({
            translate(this@Canvas.size.width / 2, this@Canvas.size.height / 2)
            scale(k, k, pivot = Offset.Zero)
        }) {
            knight(look, frame, Moment(t ?: 0.0, if (course != null && t != null) course.mood else OrbMotion.Mood.IDLE, paper, k))
        }
    }
}

/** Whether the page is light (the brand's paper is): glyphs are ink on paper there. */
@Composable
internal fun onPaper(): Boolean = LocalBrand.current.paper.luminance() > 0.5f

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

/** When a frame is drawn: the time its glyphs change by, its mood, whether the page is light, and how many of the
 * screen's pixels a unit of the orb's square is (so a glyph is drawn from a sprite as sharp as it needs). */
internal class Moment(val t: Double, val mood: OrbMotion.Mood, val paper: Boolean, val px: Float)

private fun Orb.Palette.color(ink: Orb.Ink, opacity: Double): Color = when (ink) {
    Orb.Ink.TINT -> Color(0xff000000 or tint)
    Orb.Ink.LIGHT -> Color(0xff000000 or light)
    Orb.Ink.DEEP -> Color(0xff000000 or deep)
    Orb.Ink.WHITE -> Color.White
}.copy(alpha = opacity.coerceIn(0.0, 1.0).toFloat())

private fun hex(rgb: Long): String = "#" + java.lang.Long.toHexString(rgb and 0xffffff).padStart(6, '0')
private fun opaque(hex: String): Int = (0xff000000L or Avatar.rgb(hex)).toInt()

/** The point `r` from the middle at `angle` degrees clockwise from the top (y down). */
private fun point(r: Double, angle: Double): Offset {
    val radians = Math.toRadians(angle)
    return Offset((r * sin(radians)).toFloat(), (-r * cos(radians)).toFloat())
}

/** The orb's parts as a frame moves them, with its lights among them (OrbMotion.Moves): the still orb for STILL. */
private fun DrawScope.paint(parts: List<Orb.Part>, palette: Orb.Palette, frame: OrbMotion.Frame, stage: OrbMotion.Stage, moment: Moment) {
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
        if (turn == 0.0 && swell == 1.0) draw(part, palette, glow, frame, moment)
        else withTransform({
            if (turn != 0.0) rotate(turn.toFloat(), pivot = Offset.Zero)
            if (swell != 1.0) scale(swell.toFloat(), swell.toFloat(), pivot = Offset.Zero)
        }) { draw(part, palette, glow, frame, moment) }
        if (part.name == "halo") waves(frame, stage, palette)
    }
}

/**
 * What a part is drawn with, made once and kept for the app's life (the PWA makes each part's path and gradient once, as
 * well): a ring's or a tick's stroke and a ticks' path by the part (each level's parts are the same objects every
 * time), a gradient by its palette, its page and its part, and his sphere's points by the part. Only a glow that
 * breathes (the halo, the light round the sphere, the nucleus) is made afresh, for a frame. Touched only on the main
 * thread, where drawing is.
 */
private object Kit {
    private val strokes = IdentityHashMap<Orb.Part, Stroke>()
    private val paths = IdentityHashMap<Orb.Part.Ticks, Path>()
    private val brushes = HashMap<Long, IdentityHashMap<Orb.Part, Brush>>()
    private val spheres = IdentityHashMap<Orb.Part.Sphere, Pair<OrbSphere.Sphere, List<OrbSphere.Point>>>()
    private val inks = HashMap<Long, Inks>()

    /** His own handle's: the seed of his data ring and his sphere. */
    val seed: Long = OrbMotion.seed("galahad")

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

    fun sphere(part: Orb.Part.Sphere): Pair<OrbSphere.Sphere, List<OrbSphere.Point>> = spheres.getOrPut(part) {
        val sphere = OrbSphere.sphere("galahad")
        sphere to OrbSphere.points(sphere, part.count)
    }

    /** His sphere's shades in a palette: on a dark page his tint's, his white's second; on paper, ink deepening to the
     * front, his second his deep tint. */
    fun inks(palette: Orb.Palette, paper: Boolean): Inks = inks.getOrPut(palette.tint or (if (paper) 1L shl 32 else 0L)) {
        val (tint, light, deep) = Triple(hex(palette.tint), hex(palette.light), hex(palette.deep))
        if (paper) Inks(OrbSphere.paperShades(tint, deep), OrbSphere.paperShades(deep, Avatar.blendHex(deep, "#000000", 0.4)), deep, deep)
        else Inks(OrbSphere.shades(tint, light, deep), OrbSphere.shades("#ffffff", "#ffffff", light), light, "#ffffff")
    }

    /** A disc's gradient in a palette on its page, its stops brightened by [glow] (no more than opaque): kept when
     * unglowed. On paper his white is his deep tint: a white heart there would be a hole in the paper. */
    fun brush(part: Orb.Part.Disc, palette: Orb.Palette, glow: Double, paper: Boolean): Brush {
        if (glow != 1.0) return made(part, palette, glow, paper)
        return brushes.getOrPut(palette.tint or (if (paper) 1L shl 32 else 0L)) { IdentityHashMap() }.getOrPut(part) { made(part, palette, 1.0, paper) }
    }

    private fun made(part: Orb.Part.Disc, palette: Orb.Palette, glow: Double, paper: Boolean): Brush {
        val stops = part.stops.map { stop ->
            val opacity = minOf(1.0, stop.opacity * glow)
            stop.at.toFloat() to if (stop.ink == Orb.Ink.WHITE && paper) palette.color(Orb.Ink.DEEP, opacity) else palette.color(stop.ink, opacity)
        }.toTypedArray()
        // As SVG's radial gradient in its box: lit from (cx, cy) of the box, reaching `spread` of its width.
        val r = part.r.toFloat()
        return Brush.radialGradient(*stops, center = Offset(-r + part.cx.toFloat() * 2 * r, -r + part.cy.toFloat() * 2 * r), radius = part.spread.toFloat() * 2 * r)
    }
}

/** One part, as the PWA draws it; a glow's stops brightened by [glow] (no more than opaque). */
private fun DrawScope.draw(part: Orb.Part, palette: Orb.Palette, glow: Double, frame: OrbMotion.Frame, moment: Moment) {
    when (part) {
        is Orb.Part.Disc -> drawCircle(Kit.brush(part, palette, glow, moment.paper), radius = part.r.toFloat(), center = Offset.Zero)
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
        // His data ring: hex digits in about `share` of its places, each changing on a slow beat of its own, upright to the
        // ring as a dial's numbers are; in his deep tint on paper.
        is Orb.Part.Glyphs -> {
            val color = if (moment.paper) opaque(hex(palette.deep)) else palette.color(part.ink, 1.0).toArgb()
            drawIntoCanvas { canvas ->
                val native = canvas.nativeCanvas
                for (k in 0 until part.count) {
                    val lit = OrbSphere.dataGlyph(Kit.seed, k, moment.t, part.share) ?: continue
                    val angle = 360.0 * k / part.count
                    val at = point(part.r, angle)
                    native.save()
                    native.translate(at.x, at.y)
                    native.rotate(angle.toFloat())
                    GlyphSprites.stamp(native, lit.char, color, true, 0f, 0f, part.size.toFloat(), lit.alpha.toFloat(), moment.px)
                    native.restore()
                }
            }
        }
        // His own sphere, turning as his ring does, three times as far.
        is Orb.Part.Sphere -> {
            val (sphere, points) = Kit.sphere(part)
            val shown = OrbSphere.frame(sphere, points, OrbSphere.TURN * frame.ring, part.r, 1.0, part.glyph, moment.t, moment.mood, moment.paper)
            glyphs(shown, Kit.inks(palette, moment.paper), moment.px)
        }
    }
}

// ---- a knight's face ----------------------------------------------------------------------------------------------

/** A sphere's six shades of its tint and of its second colour (as ARGB), the colour of its lines, and its heart's. */
internal class Inks(tint: List<String>, second: List<String>, line: String, heart: String) {
    val tint = IntArray(6) { opaque(tint[it]) }
    val second = IntArray(6) { opaque(second[it]) }
    val line = Color(opaque(line))
    val heart = Color(opaque(heart))
}

/**
 * A knight's orb made ready to draw a frame at a time: its colours (Avatar's knightColors) as shades for a dark page and
 * for paper (a white heart on the dark, a deep one on paper), its sphere and its points at its size, and its arcs with
 * their strokes, all made once.
 */
internal class KnightLook(id: String, profile: Json?, level: Orb.Level) {
    val seed: Long = OrbMotion.seed(id)
    val look: OrbSphere.Look = OrbSphere.KNIGHT.getValue(level)
    val sphere: OrbSphere.Sphere = OrbSphere.sphere(id)
    val points: List<OrbSphere.Point> = OrbSphere.points(sphere, look.count)
    val arcs: List<OrbSphere.Arc> = OrbSphere.arcs(sphere, level)
    val strokes: List<Stroke> = arcs.map { Stroke(width = it.width.toFloat(), cap = StrokeCap.Round) }
    private val colors = Avatar.knightColors(id, profile)
    val tint = Color(opaque(colors.tint))
    private val secondLight = Avatar.blendHex(colors.second, "#ffffff", 0.45)
    private val secondDeep = Avatar.blendHex(colors.second, "#000000", 0.52)
    val dark = Inks(OrbSphere.shades(colors.tint, colors.light, colors.deep), OrbSphere.shades(colors.second, secondLight, secondDeep), colors.light, "#fff8eb")
    val paper = Inks(OrbSphere.paperShades(colors.tint, colors.deep), OrbSphere.paperShades(colors.second, secondDeep), colors.deep, colors.deep)

    /** The light it sits in: its tint, brightest at its middle, gone at 96. */
    val light: Brush = Brush.radialGradient(0f to tint.copy(alpha = 0.42f), 0.55f to tint.copy(alpha = 0.16f), 1f to tint.copy(alpha = 0f), center = Offset.Zero, radius = 96f)
}

/**
 * A knight's face as a frame shows it, in its square (the PWA's knightFace): the light it sits in, breathing; its arcs,
 * each turning at its own pace against the ring's turn; its bright heart; then its glyphs, back to front. [fade] makes
 * all of it fainter (a paused knight's, in its seat).
 */
internal fun DrawScope.knight(look: KnightLook, frame: OrbMotion.Frame, moment: Moment, fade: Float = 1f) {
    val ink = if (moment.paper) look.paper else look.dark
    drawCircle(look.light, radius = 96f, center = Offset.Zero, alpha = (min(1.0, frame.glow) * (if (moment.paper) 0.6 else 1.0)).toFloat() * fade)
    for ((n, arc) in look.arcs.withIndex()) {
        val from = arc.from + arc.speed * frame.ring
        val r = arc.r.toFloat()
        drawArc(ink.line.copy(alpha = 0.5f * fade), (from - 90).toFloat(), arc.length.toFloat(), useCenter = false, topLeft = Offset(-r, -r), size = Size(2 * r, 2 * r), style = look.strokes[n])
    }
    // The bright nucleus (Phren's): its heart at its middle (white on a dark page, its deep tint on paper), into its
    // tint, and gone.
    val heart = (look.look.nucleus * 2.2 * frame.scale).toFloat()
    drawCircle(
        Brush.radialGradient(
            0f to ink.heart.copy(alpha = (min(1.0, 0.95 * frame.glow)).toFloat() * fade),
            0.3f to look.tint.copy(alpha = (min(1.0, 0.65 * frame.glow)).toFloat() * fade),
            1f to look.tint.copy(alpha = 0f),
            center = Offset.Zero,
            radius = heart,
        ),
        radius = heart,
        center = Offset.Zero,
    )
    val shown = OrbSphere.frame(look.sphere, look.points, OrbSphere.TURN * frame.ring, look.look.r, frame.scale, look.look.glyph, moment.t, moment.mood, moment.paper)
    glyphs(shown, ink, moment.px, fade)
}

/** A sphere's glyphs as a frame shows them, back to front, each in its colour's shade for how near it is (data in its
 * second colour, as it reads). */
private fun DrawScope.glyphs(shown: List<OrbSphere.Shown>, ink: Inks, px: Float, fade: Float = 1f) {
    drawIntoCanvas { canvas ->
        val native = canvas.nativeCanvas
        for (glyph in shown) {
            if (glyph.alpha < 0.02) continue
            // (Its shade is 0 to 5; a glyph at the very back of the sphere could reckon -1, and is the farthest.)
            val shade = glyph.shade.coerceIn(0, 5)
            val color = if (glyph.data) ink.second[max(3, shade)] else if (glyph.second) ink.second[shade] else ink.tint[shade]
            GlyphSprites.stamp(native, glyph.char, color, glyph.data, glyph.x.toFloat(), glyph.y.toFloat(), glyph.size.toFloat(), min(1.0, glyph.alpha).toFloat() * fade, px)
        }
    }
}

/**
 * The glyphs, each drawn once in its colour at a size into a sprite of its own and stamped from it after, as the PWA and
 * Phren draw a field from an atlas: by (glyph, colour, weight, size bucket), the bucket the next of a ladder of sizes about
 * 1.41 times apart, so a sprite is never shrunk much. In a monospace face, data a little heavier. Kept for the app's life,
 * up to a few megabytes (past that they're let go, and made again as they're drawn). Touched only on the main thread.
 */
private object GlyphSprites {
    /** Every glyph a sphere or the data ring shows (OrbSphere's LADDER and DATA). */
    private const val ALPHABET = ".·':-+=ox*0#@123456789ABCDEF"
    private const val BUDGET = 8L * 1024 * 1024
    private val made = LongSparseArray<Bitmap>()
    private var bytes = 0L
    private val regular: Typeface = Typeface.create(Typeface.MONOSPACE, 500, false)
    private val heavy: Typeface = Typeface.create(Typeface.MONOSPACE, 600, false)
    private val pen = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { textAlign = android.graphics.Paint.Align.CENTER }
    private val stamp = android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG)
    private val box = RectF()

    /** A sprite's side in pixels for a glyph's box [px] pixels wide: 8, 12, 16, 23, 32, 46, 64, 91 or 128. */
    fun bucket(px: Float): Int {
        var side = 8.0
        while (side < px && side < 128) side *= Math.sqrt(2.0)
        return Math.ceil(side - 1e-9).toInt()
    }

    /** [char] [size] units high, centred on ([x], [y]), in [color], as opaque as [alpha]; [px] pixels a unit. */
    fun stamp(canvas: android.graphics.Canvas, char: String, color: Int, data: Boolean, x: Float, y: Float, size: Float, alpha: Float, px: Float) {
        val side = size * 1.28f
        val sprite = sprite(char, color, data, bucket(side * px)) ?: return
        box.set(x - side / 2, y - side / 2, x + side / 2, y + side / 2)
        stamp.alpha = (alpha.coerceIn(0f, 1f) * 255 + 0.5f).toInt()
        canvas.drawBitmap(sprite, null, box, stamp)
    }

    private fun sprite(char: String, color: Int, data: Boolean, side: Int): Bitmap? {
        val at = ALPHABET.indexOf(char)
        if (at < 0) return null
        val key = (color.toLong() and 0xffffffffL) or (at.toLong() shl 32) or ((if (data) 1L else 0L) shl 38) or (side.toLong() shl 39)
        made.get(key)?.let { return it }
        if (bytes > BUDGET) {
            made.clear()
            bytes = 0
        }
        // The glyph 0.78 of its sprite high, centred across it and its middle a little below the sprite's (the PWA's).
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        pen.typeface = if (data) heavy else regular
        pen.textSize = side * 0.78f
        pen.color = color
        val metrics = pen.fontMetrics
        android.graphics.Canvas(bitmap).drawText(char, side / 2f, side * 0.52f - (metrics.ascent + metrics.descent) / 2, pen)
        made.put(key, bitmap)
        bytes += bitmap.byteCount
        return bitmap
    }
}

// ---- the lights round an orb or a seat ----------------------------------------------------------------------------

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
