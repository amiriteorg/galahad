package org.amirite.galahad.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Galahad's orb, as the PWA draws it (lib/orb.ts, through the parity vectors the Apple app is held to): the same colours
 * and the same parts at every size.
 */
class OrbTest {
    private val v: Json = Json.parse(javaClass.classLoader!!.getResource("core-vectors.json")!!.readText())["orb"]!!

    private fun hex(color: Long) = "#%06x".format(color)

    @Test fun eachStatesColoursAreThePWAs() {
        assertEquals(v["palettes"].fields.keys, Orb.Tone.entries.map { it.wire }.toSet())
        for (tone in Orb.Tone.entries) {
            val theirs = v["palettes"][tone.wire]
            val mine = Orb.palette(tone)
            assertEquals(tone.wire, listOf(theirs["tint"].string, theirs["light"].string, theirs["deep"].string), listOf(hex(mine.tint), hex(mine.light), hex(mine.deep)))
        }
    }

    @Test fun eachLevelIsDrawnFromThePWAsParts() {
        assertEquals(setOf("badge", "seat", "full"), v["levels"].fields.keys)
        for ((level, parts) in v["levels"].fields) {
            val size = when (level) { "badge" -> 28.0; "seat" -> 64.0; else -> 168.0 }
            assertEquals(level, parts.list.map(::part), Orb.parts(size))
        }
    }

    @Test fun eachSizeShowsAsMuchOfHimAsThePWAs() {
        for (s in v["sizes"].list) assertEquals("${s["size"].double}", s["level"].string, Orb.level(s["size"].double!!).wire)
    }

    @Test fun hisLinesToneIsHisOrbs() {
        assertEquals(listOf(Orb.Tone.NEUTRAL, Orb.Tone.ACCENT, Orb.Tone.WARN, Orb.Tone.OK, Orb.Tone.NEUTRAL), listOf("neutral", "accent", "warn", "ok", "pulse").map(Orb::tone))
        assertEquals(Orb.Tone.WARN, Orb.tone(KnightState.NEEDS))
        assertEquals(Orb.Tone.ACCENT, Orb.tone(KnightState.WORKING))
        assertEquals(Orb.Tone.OK, Orb.tone(KnightState.UNREAD))
        assertEquals(Orb.Tone.NEUTRAL, Orb.tone(KnightState.RESTING))
    }

    @Test fun whereHeStandsIsHisSeatsColourAsThePWAs() {
        for (s in v["states"].list) {
            val state = KnightState.entries.first { it.wire == s["state"].string }
            assertEquals(s["state"].string, s["tone"].string, Orb.tone(state).wire)
        }
    }

    /** A part as lib/orb.ts wrote it, as this app's own (what it doesn't carry is NaN, which equals nothing). */
    private fun part(j: Json): Orb.Part {
        fun n(key: String) = j[key].double ?: Double.NaN
        fun ink(value: Json?) = Orb.Ink.entries.firstOrNull { it.name.lowercase() == value.string } ?: Orb.Ink.WHITE
        val stops = j["stops"].list.map { Orb.Stop(it["at"].double ?: Double.NaN, ink(it["ink"]), it["opacity"].double ?: Double.NaN) }
        val name = j["name"].string ?: ""
        return when (j["kind"].string) {
            "disc" -> Orb.Part.Disc(name, n("r"), n("cx"), n("cy"), n("spread"), stops)
            "ring" -> Orb.Part.Ring(name, n("r"), n("width"), ink(j["ink"]), n("opacity"), (j["arcs"] as? Json.Arr)?.items?.map { Orb.Arc(it[0].double ?: Double.NaN, it[1].double ?: Double.NaN) })
            "ticks" -> Orb.Part.Ticks(name, n("r"), j["count"].int ?: -1, n("offset"), n("length"), n("width"), ink(j["ink"]), n("opacity"))
            "rim" -> Orb.Part.Rim(name, n("r"), n("width"), j["from"][0].double ?: Double.NaN, j["from"][1].double ?: Double.NaN, j["to"][0].double ?: Double.NaN, j["to"][1].double ?: Double.NaN, stops)
            else -> Orb.Part.Shine(name, n("cx"), n("cy"), n("rx"), n("ry"), n("rotate"), n("opacity"))
        }
    }
}
