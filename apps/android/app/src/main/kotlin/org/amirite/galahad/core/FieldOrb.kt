package org.amirite.galahad.core

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * The orbs as fields (the PWA's lib/field-orb.ts, 26 November 2026): Galahad's field (Field) is every orb, his in gold
 * inside his heads-up ring, each knight's in its own colours. The owner's words: the glyph spheres "still look a little
 * strange/not cool enough, and almost like nipples", and "i dont want them to be too visually distractin". So a field
 * has no bright middle (its core stays dark), no regular lattice of dots, and no ring round a knight; it is still where it
 * is one of many, and moves slowly where it is the one you are looking at. Pure: whose field an orb is, how it is drawn
 * at a size, how it moves in each mood, its embers and its ink on a light page. ui/Field.kt draws it; the vectors'
 * `field` section holds it to the PWA's own numbers.
 */
object FieldOrb {
    /** Whose field an orb is: its seed (its lines' longitudes and widths), its lean (Field.model's tilt), how many lines,
     * and its colours. */
    data class Identity(val seed: Long, val tilt: List<Double>, val lines: Int, val colours: Field.Colours)

    /** Galahad's: the icon's own field, in gold. */
    val GALAHAD = Identity(11, listOf(0.42, 0.3, -0.18), 46, Field.AURUM)

    /**
     * A knight's: its colours are Avatar's knightColors (the one you chose for it, or its handle's): its key light its tint
     * lit and its tint, its rim its second colour. Its handle gives the rest: 12 to 20 lines, their longitudes and widths
     * (its seed), and its lean: its axis turned up to about 40 degrees either way in the picture, and leaning towards you
     * by 0.25 to 0.5 (the sine of its angle with the picture), so it is always seen from the side, never end on or flat.
     */
    fun knight(id: String, profile: Json? = null): Identity {
        val colours = Avatar.knightColors(id, profile)
        val seed = OrbMotion.seed(id)
        val ay = -0.5 + OrbMotion.rand(seed, 0, 61)
        val az = -0.65 + 1.3 * OrbMotion.rand(seed, 0, 62)
        val towards = 0.25 + 0.25 * OrbMotion.rand(seed, 0, 60)
        // The axis (y, before the lean) ends up with z = cos(az)·sin(ax) + sin(az)·sin(ay)·cos(ax) = R·sin(ax + δ): the lean
        // about x that gives it `towards`.
        val a = cos(az)
        val b = sin(az) * sin(ay)
        val ax = asin(towards / hypot(a, b)) - atan2(b, a)
        return Identity(1 + (seed % 2147483646), listOf(ax, ay, az), 12 + floor(9 * OrbMotion.rand(seed, 0, 63)).toInt(), Field.Colours(listOf(colours.light, colours.tint), colours.second))
    }

    /** How a field is drawn at a size (dp): how many of its lines, points along each, how bold, and how far it reaches in
     * its square (at 1 its widest point is 0.44 to 0.47 of its width from the middle). */
    data class Look(val lines: Int, val steps: Int, val weight: Double, val zoom: Double)

    /** A field at a size. In Galahad's ring ([ringed]) it is drawn smaller, clear of the ring, and with fewer of his lines
     * where he is small; a knight's fills its square. The larger, the more points along a line, and the smaller, the bolder. */
    fun look(identity: Identity, size: Double, ringed: Boolean): Look {
        val s = if (size.isFinite()) max(8.0, size) else 36.0
        val lines = if (ringed) min(identity.lines, if (s < 30) 26 else if (s < 56) 34 else 46) else identity.lines
        return Look(lines, jsRound(max(20.0, min(96.0, s * 0.55))).toInt(), if (s <= 24) 1.5 else if (s <= 48) 1.25 else 1.0, if (ringed) 0.86 else 0.94)
    }

    /** Galahad's heads-up ring round his field: five arcs of ink a sixth of the way round each, with gaps between, and at
     * the top, alone, his seat in oxblood. Angles are degrees clockwise from the top; the radius and widths are shares of
     * the orb's width, never thinner than a pixel. */
    object Ring {
        const val R = 0.465
        const val WIDTH = 1.0 / 64
        val ARCS: List<Pair<Double, Double>> = listOf(38.0 to 82.0, 98.0 to 142.0, 158.0 to 202.0, 218.0 to 262.0, 278.0 to 322.0)
        const val SEAT_FROM = -15.0
        const val SEAT_TO = 15.0
        const val SEAT_WIDTH = 1.8
        const val INK_DARK = "#e8eaf0"
        const val INK_PAPER = "#181a22"
        const val ALPHA_DARK = 0.26
        const val ALPHA_PAPER = 0.28
        const val OXBLOOD_DARK = "#c8323f"
        const val OXBLOOD_PAPER = "#9a1f2b"
    }

    /** How wide his ring's line is, in pixels, for an orb [size] pixels wide (its seat's is Ring.SEAT_WIDTH as wide). */
    fun ringWidth(size: Double): Double = max(1.0, size * Ring.WIDTH)

    // ---- how it moves ------------------------------------------------------------------------------------------------

    /** A slow breath of brightness: its seconds, and its depth (0.2 is a fifth brighter and dimmer). */
    data class Breath(val period: Double, val depth: Double)

    /**
     * A mood's motion, slow and calm (your word, 25 November 2026: "slow and calming movement"): radians a second it
     * turns ([turn]; 0.1 is a turn a minute), how bright ([glow], 1 at rest), a slow [breath] or none, whether a few
     * [embers] drift off its rim (his alone), and how far its burning rim has dimmed towards red-brown ([rim], 0 to 1).
     */
    data class Motion(val turn: Double, val glow: Double, val breath: Breath?, val embers: Boolean, val rim: Double)

    /** Galahad's moods: at rest it turns slowly; at work a little quicker, embers drifting off its rim; waiting on you it
     * breathes; queued and paused it dims and slows (paused stops); done, it settles; failed, its rim dims to red-brown. */
    val MOTION: Map<OrbMotion.Mood, Motion> = mapOf(
        OrbMotion.Mood.IDLE to Motion(0.1, 1.0, null, false, 0.0),
        OrbMotion.Mood.WORKING to Motion(0.2, 1.08, null, true, 0.0),
        OrbMotion.Mood.WAITING to Motion(0.08, 1.0, Breath(5.2, 0.2), false, 0.0),
        OrbMotion.Mood.QUEUED to Motion(0.06, 0.85, null, false, 0.0),
        OrbMotion.Mood.PAUSED to Motion(0.0, 0.7, null, false, 0.0),
        OrbMotion.Mood.DONE to Motion(0.035, 1.0, null, false, 0.0),
        OrbMotion.Mood.FAILED to Motion(0.03, 0.88, null, false, 1.0),
    )

    /** A knight's: it moves only while it works (your word, 26 November 2026: still in rows, moving only in its own
     * thread's header while it works), turning as his does at work, with no embers; in every other mood it comes to rest,
     * in that mood's light. */
    fun motion(mood: OrbMotion.Mood, knight: Boolean): Motion {
        val m = MOTION.getValue(mood)
        if (!knight) return m
        return if (mood == OrbMotion.Mood.WORKING) m.copy(embers = false) else m.copy(turn = 0.0, breath = null, embers = false)
    }

    /** Seconds a speed, a light or a tint takes to ease most of the way (63 %) to a new mood's: a mood arrives over about
     * two seconds. */
    const val EASE = 0.6

    /** What a field carries from one frame to the next, so a change of mood speeds or slows its turning, brightens or dims
     * it, with no jump: how far it has turned (0 to 2π) and how fast now, its brightness and its rim's dimming now, its
     * breath's depth now, how far through a breath it is and a breath's seconds, and how much of its embers show. */
    data class Clock(val turn: Double, val speed: Double, val glow: Double, val rim: Double, val depth: Double, val breath: Double, val period: Double, val embers: Double)

    /** A field as it is first seen: settled in its motion, at its rest (turned 0, a breath not begun). */
    fun clock(motion: Motion): Clock = Clock(0.0, motion.turn, motion.glow, motion.rim, motion.breath?.depth ?: 0.0, 0.0, motion.breath?.period ?: 6.0, if (motion.embers) 1.0 else 0.0)

    /** The clock [dt] seconds on, in a motion: each speed and light eased towards the motion's, then turned on. A step
     * longer than a frame takes (the app coming back) turns nothing a long way at once. */
    fun step(clock: Clock, motion: Motion, dt: Double): Clock {
        val d = min(OrbMotion.LONGEST_STEP, max(0.0, dt))
        val ease = 1 - exp(-d / EASE)
        fun toward(value: Double, target: Double) = value + (target - value) * ease
        val speed = toward(clock.speed, motion.turn)
        val period = motion.breath?.period ?: clock.period
        return Clock(
            turn = turned(clock.turn + speed * d),
            speed = speed,
            glow = toward(clock.glow, motion.glow),
            rim = toward(clock.rim, motion.rim),
            depth = toward(clock.depth, motion.breath?.depth ?: 0.0),
            breath = fract(clock.breath + d / period),
            period = period,
            embers = toward(clock.embers, if (motion.embers) 1.0 else 0.0),
        )
    }

    /** Whether a clock has come to its motion: nothing left to ease. */
    fun settled(clock: Clock, motion: Motion): Boolean {
        fun near(a: Double, b: Double, by: Double = 0.002) = kotlin.math.abs(a - b) <= by
        return near(clock.speed, motion.turn, 0.0005) && near(clock.glow, motion.glow) && near(clock.rim, motion.rim) &&
            near(clock.depth, motion.breath?.depth ?: 0.0) && near(clock.embers, if (motion.embers) 1.0 else 0.0, 0.005)
    }

    /** How many frames a second a field needs now: as few as look smooth (each frame costs a battery). While it eases to a
     * mood or its embers drift, 30; breathing, 20; only turning, 15; and none once it has come to rest. */
    fun fps(clock: Clock, motion: Motion): Int {
        if (!settled(clock, motion) || clock.embers > 0.01) return 30
        if (clock.depth > 0.002) return 20
        return if (clock.speed > 0.0005) 15 else 0
    }

    /** An ember: where it is in the orb's square (its middle 0, its edge 1; x right, y down), its radius there, and how
     * opaque. */
    data class Ember(val x: Double, val y: Double, val r: Double, val alpha: Double)

    /** A moment of a field: how far it is turned, how bright, how far its rim has dimmed, and its embers. */
    data class Frame(val turn: Double, val glow: Double, val rim: Double, val embers: List<Ember>)

    /** His embers: how many; each lives 2.8 to 4.4 seconds; where they set out (a share of the way from the middle to the
     * edge of the orb's square) and how far each drifts; how much they rise; how far round from the rim's burning side
     * they may set out (degrees either way); and their radius. Inside his ring always. */
    object Embers {
        const val COUNT = 7
        const val LIFE_FROM = 2.8
        const val LIFE_TO = 4.4
        const val FROM_FROM = 0.56
        const val FROM_TO = 0.64
        const val DRIFT_FROM = 0.1
        const val DRIFT_TO = 0.2
        const val RISE = 0.06
        const val SPREAD = 70.0
        const val SIZE_FROM = 0.016
        const val SIZE_TO = 0.028
    }

    /** Where the rim burns, in degrees clockwise from the top (Field's rim light, seen from the front: lower right). */
    val RIM_ANGLE: Double = (atan2(Field.RIM[0], Field.RIM[1]) * 180) / PI

    /** A field at [t] seconds, as its clock stands: its breath in its brightness, and (where it has them, [embers]) its
     * embers, seeded by [seed] so two never drift as one. */
    fun frame(clock: Clock, t: Double, seed: Long = 0, embers: Boolean = false): Frame {
        val glow = clock.glow * (1 + clock.depth * sin(2 * PI * clock.breath))
        val shown = if (embers && clock.embers > 0.01) embersAt(seed and 0xffffffffL, t, clock.embers) else emptyList()
        return Frame(clock.turn, glow, clock.rim, shown)
    }

    /** A field still: at its rest (turned 0), in its mood's light (dimmed, or its rim red-brown), with no breath and no
     * embers. What a row shows, a conversation's history, and every orb while the phone's animations are off. */
    fun still(motion: Motion): Frame = Frame(0.0, motion.glow, motion.rim, emptyList())

    private fun embersAt(seed: Long, t: Double, share: Double): List<Ember> {
        val out = ArrayList<Ember>(Embers.COUNT)
        for (i in 0 until Embers.COUNT) {
            val life = Embers.LIFE_FROM + (Embers.LIFE_TO - Embers.LIFE_FROM) * OrbMotion.rand(seed, i, 70)
            val at = t / life + OrbMotion.rand(seed, i, 71)
            val round = floor(at)
            val u = at - round
            // Each time it sets out, from somewhere else (JavaScript's (seed + Math.imul(round, 0x9e3779b1)) >>> 0).
            val lot = (seed + (round.toLong().toInt() * 0x9e3779b1.toInt()).toLong()) and 0xffffffffL
            val angle = ((RIM_ANGLE + Embers.SPREAD * (2 * OrbMotion.rand(lot, i, 72) - 1)) * PI) / 180
            val reach = Embers.FROM_FROM + (Embers.FROM_TO - Embers.FROM_FROM) * OrbMotion.rand(lot, i, 73) + (Embers.DRIFT_FROM + (Embers.DRIFT_TO - Embers.DRIFT_FROM) * OrbMotion.rand(lot, i, 74)) * u
            val fadeIn = min(1.0, u / 0.15)
            out += Ember(
                x = reach * sin(angle),
                y = -reach * cos(angle) - Embers.RISE * u,
                r = (Embers.SIZE_FROM + (Embers.SIZE_TO - Embers.SIZE_FROM) * OrbMotion.rand(lot, i, 75)) * (1 - 0.4 * u),
                alpha = share * fadeIn * fadeIn * (3 - 2 * fadeIn) * (1 - u) * (1 - u),
            )
        }
        return out
    }

    // ---- its colours ----------------------------------------------------------------------------------------------------

    /** Where a failed field's rim dims to: a red-brown, an ember going out. */
    const val RIM_DIM = "#5a2416"

    /** A field's colours in a moment: its rim dimmed [rim] of the way (0.7 at most) towards red-brown. */
    fun colours(colours: Field.Colours, rim: Double): Field.Colours =
        if (rim > 0.001) Field.Colours(colours.key, Avatar.blendHex(colours.rim, RIM_DIM, 0.7 * min(1.0, rim))) else colours

    /** How a point's light is shown on a dark page, as the icon shows it: three.js' ACES filmic tone mapping (r160) at the
     * icon's exposure, to sRGB, 0 to 1 a channel, into [out]. */
    const val EXPOSURE = 1.12

    fun tone(r: Double, g: Double, b: Double, exposure: Double = EXPOSURE, out: DoubleArray = DoubleArray(3)): DoubleArray {
        val e = exposure / 0.6
        val x = r * e
        val y = g * e
        val z = b * e
        fun fit(v: Double) = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)
        val f0 = fit(0.59719 * x + 0.35458 * y + 0.04823 * z)
        val f1 = fit(0.076 * x + 0.90834 * y + 0.01566 * z)
        val f2 = fit(0.0284 * x + 0.13383 * y + 0.83777 * z)
        fun srgb(v: Double): Double {
            val c = max(0.0, min(1.0, v))
            return if (c <= 0.0031308) c * 12.92 else 1.055 * c.pow(1 / 2.4) - 0.055
        }
        out[0] = srgb(1.60475 * f0 - 0.53108 * f1 - 0.07367 * f2)
        out[1] = srgb(-0.10208 * f0 + 1.10813 * f1 - 0.00605 * f2)
        out[2] = srgb(-0.00327 * f0 - 0.07276 * f1 + 1.07602 * f2)
        return out
    }

    /**
     * How a field's lines are drawn, from point to point along each (dp): a line's width from [LEAST] where it is faintest
     * to [LEAST] + [MORE] where brightest, times its look's weight; under each line on a dark page its light again,
     * [GLOW_WIDTH] times as wide and [GLOW_ALPHA] as strong (close, so no fog: your word, 26 November 2026, "less fog, so
     * it reads clearer"); a line's width on a light page, [INK] of its width on a dark one; and how much of its points'
     * light a line shows on a dark page ([LIGHT]), less again where it is smaller than [FULL].
     */
    object Stroke {
        const val LEAST = 0.42
        const val MORE = 0.5
        const val GLOW_WIDTH = 3.2
        const val GLOW_ALPHA = 0.12
        const val INK = 0.85
        const val LIGHT = 0.22
        const val FULL = 96.0
    }

    /** How much of its points' light a field [size] wide shows on a dark page. */
    fun strokeLight(size: Double): Double = Stroke.LIGHT * min(1.0, size / Stroke.FULL)

    /** A field's inks on a light page, as sRGB (0 to 255 each): where its key light falls, its key's deep colour darkened
     * (it would be white on white otherwise), and where its rim burns, its rim's, darkened less. */
    data class Inks(val key: IntArray, val rim: IntArray)

    fun inks(colours: Field.Colours): Inks {
        fun rgb(hex: String) = intArrayOf(hex.substring(1, 3).toInt(16), hex.substring(3, 5).toInt(16), hex.substring(5, 7).toInt(16))
        return Inks(rgb(Avatar.blendHex(colours.key[1], "#000000", 0.38)), rgb(Avatar.blendHex(colours.rim, "#000000", 0.22)))
    }

    /** A point's ink on a light page: between its two inks by the key's and the rim's shares of its light, and as opaque
     * as it is lit, faint where it is dark (so the field keeps its depth on paper). */
    class Ink(val r: Double, val g: Double, val b: Double, val alpha: Double)

    fun ink(inks: Inks, lit: Double, rim: Double): Ink {
        val total = lit + rim
        val share = if (total > 0) rim / total else 0.0
        fun mix(at: Int) = inks.key[at] + (inks.rim[at] - inks.key[at]) * share
        return Ink(mix(0), mix(1), mix(2), min(1.0, 0.1 + 0.95 * max(lit, rim)))
    }

    /** JavaScript's Math.round: halves go up (towards +∞). */
    internal fun jsRound(x: Double): Double = floor(x + 0.5).let { if (it - x > 0.5) it - 1 else it }

    private fun fract(x: Double): Double = x - floor(x)

    /** An angle as 0 up to 2π radians. */
    private fun turned(radians: Double): Double {
        val r = radians % (2 * PI)
        return if (r < 0) r + 2 * PI else r
    }
}
