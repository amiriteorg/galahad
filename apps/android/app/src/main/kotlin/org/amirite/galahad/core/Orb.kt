package org.amirite.galahad.core

/**
 * Galahad's orb, as data (the PWA's lib/orb.ts, the Apple app's Orb.swift, held to them by the vectors; your word,
 * 23 November 2026: he is the one you talk to, "a Jarvis … like visual, the orb graphic"): a sphere of light inside the
 * rings of a heads-up display, in the colour of his state. The parts it is drawn from, in a square 200 wide centred on
 * its middle (y down), and each state's colours; ui/Orb.kt draws them, moved as OrbMotion says where he is doing
 * something (your word, 24 November 2026), and still otherwise.
 */
object Orb {
    /** His line's tone (Roster.Now's), and red for a failure. */
    enum class Tone { NEUTRAL, ACCENT, WARN, OK, DANGER; val wire: String get() = name.lowercase() }

    /** How much of him a size can show: a badge (beside his words), a seat (at the Roundtable), or all of him (his home). */
    enum class Level { BADGE, SEAT, FULL; val wire: String get() = name.lowercase() }

    /** What a part is coloured with: one of its palette's colours, or white. */
    enum class Ink { TINT, LIGHT, DEEP, WHITE }

    /** A state's colours: its tint, the tint lit (45 % of it, with white) and in shadow (52 %, with black), mixed in OKLab. */
    data class Palette(val tint: Long, val light: Long, val deep: Long)

    /** A gradient's stop: how far along it (0 to 1), its colour, and how opaque. */
    data class Stop(val at: Double, val ink: Ink, val opacity: Double)

    /** An arc of a ring, in degrees clockwise from the top. */
    data class Arc(val from: Double, val to: Double)

    /** A part, drawn in order, each over those before it; its name is the PWA's (its SVG class). */
    sealed interface Part {
        val name: String

        /** A circle filled by a radial gradient, lit from (cx, cy) as fractions of its box, reaching `spread` of its width. */
        data class Disc(override val name: String, val r: Double, val cx: Double, val cy: Double, val spread: Double, val stops: List<Stop>) : Part

        /** A circle's stroke, whole (no arcs) or only its arcs. */
        data class Ring(override val name: String, val r: Double, val width: Double, val ink: Ink, val opacity: Double, val arcs: List<Arc>?) : Part

        /** `count` short strokes across a circle, evenly round from `offset` degrees, each `length` long and `width` wide. */
        data class Ticks(override val name: String, val r: Double, val count: Int, val offset: Double, val length: Double, val width: Double, val ink: Ink, val opacity: Double) : Part

        /** A circle's stroke lit along the line from (fromX, fromY) to (toX, toY) (a linear gradient). */
        data class Rim(override val name: String, val r: Double, val width: Double, val fromX: Double, val fromY: Double, val toX: Double, val toY: Double, val stops: List<Stop>) : Part

        /** An ellipse of white, turned by `rotate` degrees about its middle. */
        data class Shine(override val name: String, val cx: Double, val cy: Double, val rx: Double, val ry: Double, val rotate: Double, val opacity: Double) : Part
    }

    /** From these sizes (dp), a seat's rings and then the full display's ticks can be told apart. */
    const val SEAT_FROM = 48.0
    const val FULL_FROM = 120.0

    fun level(size: Double): Level = if (size >= FULL_FROM) Level.FULL else if (size >= SEAT_FROM) Level.SEAT else Level.BADGE

    /** The parts of an orb this size, in the order they're drawn. */
    fun parts(size: Double): List<Part> = when (level(size)) {
        Level.BADGE -> BADGE
        Level.SEAT -> SEAT
        Level.FULL -> FULL
    }

    /**
     * Each state's light: a calm blue at rest, a brighter blue at work, amber when something waits on you, green for an
     * answer new to you, red for a failure. The bright tints in both themes. (0xRRGGBB.)
     */
    val palettes: Map<Tone, Palette> = mapOf(
        Tone.NEUTRAL to Palette(0x8ab8ff, 0xcae0ff, 0x354969),
        Tone.ACCENT to Palette(0x58a6ff, 0xb6d8ff, 0x1f4169),
        Tone.WARN to Palette(0xf0b549, 0xf9dfb4, 0x624818),
        Tone.OK to Palette(0x4cc38a, 0xb6e5c9, 0x1a4e35),
        Tone.DANGER to Palette(0xff6b6b, 0xffc0bb, 0x692727),
    )

    fun palette(tone: Tone): Palette = palettes.getValue(tone)

    /** His line's tone ("neutral", "accent", "warn", "ok"), as the orb shows it; one it doesn't know is its rest. */
    fun tone(wire: String?): Tone = Tone.entries.firstOrNull { it.wire == wire } ?: Tone.NEUTRAL

    /** Where he stands at the Roundtable, as his ring there would show it. */
    fun tone(state: KnightState?): Tone = when (state?.tone) {
        KnightState.Tone.WORK -> Tone.ACCENT
        KnightState.Tone.NEEDS -> Tone.WARN
        KnightState.Tone.FAILED -> Tone.DANGER
        KnightState.Tone.OK -> Tone.OK
        KnightState.Tone.NEUTRAL, null -> Tone.NEUTRAL
    }

    // ---- the parts (lib/orb.ts' PARTS) ----

    /** The four gaps of the outer ring, at the top, the sides and the foot, where its notches stand. */
    private fun quarters(gap: Double) = listOf(0.0, 90.0, 180.0, 270.0).map { Arc(it + gap, it + 90 - gap) }

    /** Three arcs a third of the way round from each other: the display's segments. */
    private val thirds = listOf(Arc(20.0, 90.0), Arc(140.0, 210.0), Arc(260.0, 330.0))

    private val halo = Part.Disc("halo", 99.0, 0.5, 0.5, 0.5, listOf(Stop(0.0, Ink.TINT, 0.55), Stop(0.62, Ink.TINT, 0.2), Stop(1.0, Ink.TINT, 0.0)))
    private fun body(r: Double) = Part.Disc("body", r, 0.4, 0.36, 0.72, listOf(Stop(0.0, Ink.WHITE, 0.96), Stop(0.24, Ink.LIGHT, 1.0), Stop(0.64, Ink.TINT, 1.0), Stop(1.0, Ink.DEEP, 1.0)))

    /** Light through the glass, gathered at its lower edge as a marble's is. */
    private fun rim(r: Double, width: Double, reach: Double) = Part.Rim("rim", r, width, -reach, -reach, reach, reach, listOf(Stop(0.0, Ink.WHITE, 0.0), Stop(0.55, Ink.WHITE, 0.0), Stop(1.0, Ink.WHITE, 0.55)))
    private fun core(r: Double) = Part.Disc("core", r, 0.5, 0.5, 0.5, listOf(Stop(0.0, Ink.WHITE, 0.85), Stop(1.0, Ink.WHITE, 0.0)))
    private fun shine(cx: Double, cy: Double, rx: Double, ry: Double) = Part.Shine("shine", cx, cy, rx, ry, -28.0, 0.3)

    private val FULL: List<Part> = listOf(
        halo,
        Part.Ring("ring", 95.0, 1.1, Ink.TINT, 0.5, quarters(6.0)),
        Part.Ticks("notches", 95.0, 4, 0.0, 9.0, 1.6, Ink.TINT, 0.8),
        Part.Ticks("ticks", 86.5, 72, 0.0, 3.0, 0.8, Ink.TINT, 0.45),
        Part.Ticks("marks", 86.5, 12, 0.0, 7.0, 1.4, Ink.TINT, 0.75),
        Part.Ring("segments", 77.0, 2.6, Ink.TINT, 0.55, thirds),
        Part.Ring("inner", 70.5, 0.8, Ink.TINT, 0.28, null),
        body(60.0),
        rim(58.6, 1.8, 41.0),
        core(26.0),
        shine(-21.0, -27.0, 19.0, 10.0),
        Part.Shine("glint", -31.0, -35.0, 3.4, 2.6, -28.0, 0.8),
    )

    private val SEAT: List<Part> = listOf(
        halo,
        Part.Ring("ring", 94.0, 2.4, Ink.TINT, 0.55, quarters(8.0)),
        Part.Ticks("notches", 94.0, 4, 0.0, 12.0, 3.2, Ink.TINT, 0.85),
        Part.Ring("segments", 80.0, 4.5, Ink.TINT, 0.5, thirds),
        body(66.0),
        rim(64.4, 2.6, 45.0),
        core(28.0),
        shine(-23.0, -30.0, 21.0, 11.0),
    )

    private val BADGE: List<Part> = listOf(
        Part.Ring("ring", 94.0, 5.0, Ink.TINT, 0.5, null),
        body(78.0),
        rim(76.0, 3.5, 53.0),
        core(30.0),
        shine(-27.0, -34.0, 24.0, 13.0),
    )
}
