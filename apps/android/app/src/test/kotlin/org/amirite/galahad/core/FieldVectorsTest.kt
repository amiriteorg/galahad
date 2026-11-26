package org.amirite.galahad.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reads the parity vectors where they are (apps/apple/GalahadTests/Fixtures/core-vectors.json), as VectorsTest does. */
internal object Fixture {
    val vectors: Json by lazy { Json.parse(javaClass.classLoader!!.getResource("core-vectors.json")!!.readText()) }

    /** A number as the vectors hold it: to a billionth of itself (or of 1, for small ones). */
    fun near(want: Double?, got: Double, at: String) {
        requireNotNull(want) { "$at: no number in the vectors" }
        assertTrue("$at: $got ≠ $want", kotlin.math.abs(want - got) <= 1e-9 * maxOf(1.0, kotlin.math.abs(want), kotlin.math.abs(got)))
    }

    fun numbers(j: Json?): List<Double> = j.list.map { it.double!! }
}

/**
 * The orbs as fields (the PWA's lib/field.ts and lib/field-orb.ts) against the vectors' `field` section: the lights,
 * whose field each orb is, a field's lines and points at given turns, where they fall on a picture, each size's look,
 * his lance, how a field moves in each mood, its embers, tints, tone and inks. Numbers to a billionth, all else exactly.
 */
class FieldVectorsTest {
    private val f = Fixture.vectors["field"]!!
    private fun near(want: Json?, got: Double, at: String) = Fixture.near(want.double, got, at)

    private fun colours(j: Json?): Field.Colours = Field.Colours(j["key"].list.map { it.string!! }, j["rim"].string!!)

    private fun identity(who: String): FieldOrb.Identity = when (who) {
        "galahad" -> FieldOrb.GALAHAD
        "ada, chosen" -> FieldOrb.knight("ada", Json.obj("v" to 2, "color" to "#3ABEFF"))
        else -> FieldOrb.knight(who)
    }

    private fun mood(name: String): OrbMotion.Mood = OrbMotion.Mood.valueOf(name.uppercase())

    private fun assertMotion(want: Json?, got: FieldOrb.Motion, at: String) {
        near(want["turn"], got.turn, "$at.turn")
        near(want["glow"], got.glow, "$at.glow")
        near(want["rim"], got.rim, "$at.rim")
        assertEquals("$at.embers", want["embers"].bool, got.embers)
        val breath = want["breath"]
        if (breath == null || breath == Json.Null) assertEquals("$at.breath", null, got.breath)
        else {
            near(breath["period"], got.breath!!.period, "$at.breath.period")
            near(breath["depth"], got.breath.depth, "$at.breath.depth")
        }
    }

    private fun clockOf(j: Json?) = FieldOrb.Clock(
        j["turn"].double!!, j["speed"].double!!, j["glow"].double!!, j["rim"].double!!, j["depth"].double!!, j["breath"].double!!, j["period"].double!!, j["embers"].double!!,
    )

    private fun assertClock(want: Json?, got: FieldOrb.Clock, at: String) {
        for ((name, value) in listOf("turn" to got.turn, "speed" to got.speed, "glow" to got.glow, "rim" to got.rim, "depth" to got.depth, "breath" to got.breath, "period" to got.period, "embers" to got.embers)) {
            near(want[name], value, "$at.$name")
        }
    }

    private fun assertFrame(want: Json?, got: FieldOrb.Frame, at: String) {
        near(want["turn"], got.turn, "$at.turn")
        near(want["glow"], got.glow, "$at.glow")
        near(want["rim"], got.rim, "$at.rim")
        val embers = want["embers"].list
        assertEquals("$at.embers", embers.size, got.embers.size)
        embers.forEachIndexed { i, e ->
            near(e["x"], got.embers[i].x, "$at.embers[$i].x")
            near(e["y"], got.embers[i].y, "$at.embers[$i].y")
            near(e["r"], got.embers[i].r, "$at.embers[$i].r")
            near(e["alpha"], got.embers[i].alpha, "$at.embers[$i].alpha")
        }
    }

    @Test fun theLightsAreThePwas() {
        val lights = f["lights"]
        Fixture.numbers(lights["key"]).forEachIndexed { i, v -> Fixture.near(v, Field.KEY[i], "key[$i]") }
        Fixture.numbers(lights["rim"]).forEachIndexed { i, v -> Fixture.near(v, Field.RIM[i], "rim[$i]") }
        near(lights["exposure"], FieldOrb.EXPOSURE, "exposure")
    }

    @Test fun whoseFieldEachOrbIs() {
        val g = f["galahad"]
        assertEquals(g["seed"].long, FieldOrb.GALAHAD.seed)
        assertEquals(g["lines"].int, FieldOrb.GALAHAD.lines)
        Fixture.numbers(g["tilt"]).forEachIndexed { i, v -> Fixture.near(v, FieldOrb.GALAHAD.tilt[i], "galahad.tilt[$i]") }
        assertEquals(colours(g["colours"]), FieldOrb.GALAHAD.colours)
        for (k in f["knights"].list) {
            val handle = k["handle"].string!!
            val profile = k["profile"].takeIf { it != Json.Null }
            val got = FieldOrb.knight(handle, profile)
            val want = k["field"]
            assertEquals(handle, want["seed"].long, got.seed)
            assertEquals(handle, want["lines"].int, got.lines)
            Fixture.numbers(want["tilt"]).forEachIndexed { i, v -> Fixture.near(v, got.tilt[i], "$handle.tilt[$i]") }
            assertEquals(handle, colours(want["colours"]), got.colours)
        }
    }

    @Test fun linearLightAndShades() {
        for (c in f["linear"].list) {
            val got = Field.linear(c["hex"].string!!)
            Fixture.numbers(c["rgb"]).forEachIndexed { i, v -> Fixture.near(v, got[i], "${c["hex"].string}[$i]") }
        }
        f["shades"].list.forEachIndexed { at, c ->
            val n = Fixture.numbers(c["n"])
            val s = Field.shade(n[0], n[1], n[2], Field.light(colours(c["colours"])))
            val want = c["shade"]
            val rgb = Fixture.numbers(want["rgb"])
            Fixture.near(rgb[0], s.r, "shades[$at].r")
            Fixture.near(rgb[1], s.g, "shades[$at].g")
            Fixture.near(rgb[2], s.b, "shades[$at].b")
            near(want["k"], s.k, "shades[$at].k")
            near(want["lit"], s.lit, "shades[$at].lit")
            near(want["rim"], s.rim, "shades[$at].rim")
        }
    }

    @Test fun eachSeedsLinesAreThePwas() {
        for (m in f["models"].list) {
            val model = Field.model(lines = m["lines"].int!!, steps = 4, seed = m["seed"].long!!)
            Fixture.numbers(m["phi"]).forEachIndexed { i, v -> Fixture.near(v, model.phi[i], "phi[$i] of ${m["seed"].long}") }
            Fixture.numbers(m["width"]).forEachIndexed { i, v -> Fixture.near(v, model.width[i], "width[$i] of ${m["seed"].long}") }
        }
    }

    @Test fun aFieldsPointsAtATurnAreThePwas() {
        for (p in f["points"].list) {
            val who = p["who"].string!!
            val id = identity(who)
            val size = p["size"].double!!
            val galahad = p["galahad"].bool!!
            val rim = p["rim"].double!!
            val options = p["options"]
            // Its look at its size, and its colours in its rim's light, as the PWA chose them.
            val look = FieldOrb.look(id, size, galahad)
            assertEquals(who, options["lines"].int, look.lines)
            near(options["weight"], look.weight, "$who.weight")
            assertEquals(who, colours(options["colours"]), id.colours)
            Fixture.numbers(options["tilt"]).forEachIndexed { i, v -> Fixture.near(v, id.tilt[i], "$who.tilt[$i]") }
            assertEquals(who, options["seed"].long, id.seed)
            val tinted = FieldOrb.colours(id.colours, rim)
            assertEquals(who, colours(p["colours"]), tinted)
            val model = Field.model(look.lines, options["steps"].int!!, id.tilt.toDoubleArray(), look.weight, id.colours, id.seed)
            val out = Field.buffer(model)
            val count = Field.at(model, p["turn"].double!!, out, Field.light(tinted))
            val points = p["points"].list
            assertEquals("$who: how many points", points.size, count)
            points.forEachIndexed { i, q ->
                val at = "$who points[$i]"
                assertEquals(at, q["at"].int, out.at[i])
                near(q["x"], out.x[i], "$at.x")
                near(q["y"], out.y[i], "$at.y")
                near(q["z"], out.z[i], "$at.z")
                val rgb = Fixture.numbers(q["rgb"])
                Fixture.near(rgb[0], out.r[i], "$at.r")
                Fixture.near(rgb[1], out.g[i], "$at.g")
                Fixture.near(rgb[2], out.b[i], "$at.b")
                near(q["size"], out.size[i], "$at.size")
                near(q["lit"], out.lit[i], "$at.lit")
                near(q["rim"], out.rim[i], "$at.rim")
            }
        }
    }

    @Test fun whereAPointFallsOnAPicture() {
        // (The first three sets of points, three sizes each, in order: two of them are his.)
        val points = f["points"].list
        f["projections"].list.forEachIndexed { n, pr ->
            val who = pr["who"].string!!
            val set = points[n / 3]
            assertEquals(who, set["who"].string)
            val source = set["points"].list
            val size = pr["size"].double!!
            val zoom = pr["zoom"].double!!
            pr["shown"].list.forEachIndexed { i, want ->
                val p = source[i]
                val got = Field.project(p["x"].double!!, p["y"].double!!, p["z"].double!!, p["size"].double!!, size, zoom = zoom)
                val at = "$who at $size/$zoom [$i]"
                near(want["x"], got.x, "$at.x")
                near(want["y"], got.y, "$at.y")
                near(want["d"], got.d, "$at.d")
                assertEquals(at, want["visible"].bool, got.visible)
            }
        }
    }

    @Test fun eachSizesLook() {
        for (l in f["looks"].list) {
            val who = l["who"].string!!
            val got = FieldOrb.look(identity(who), l["size"].double!!, l["galahad"].bool!!)
            val want = l["look"]
            val at = "$who at ${l["size"].double}"
            assertEquals(at, want["lines"].int, got.lines)
            assertEquals(at, want["steps"].int, got.steps)
            near(want["weight"], got.weight, "$at.weight")
            near(want["zoom"], got.zoom, "$at.zoom")
        }
    }

    @Test fun hisLanceAndTheStrokes() {
        val l = f["lance"]
        near(l["from"], FieldOrb.Lance.FROM, "lance.from")
        near(l["to"], FieldOrb.Lance.TO, "lance.to")
        near(l["width"], FieldOrb.Lance.WIDTH, "lance.width")
        assertEquals(l["steps"].int, FieldOrb.Lance.STEPS)
        near(l["glow"]["width"], FieldOrb.Lance.GLOW_WIDTH, "lance.glow.width")
        near(l["glow"]["alpha"], FieldOrb.Lance.GLOW_ALPHA, "lance.glow.alpha")
        near(l["ink"]["width"], FieldOrb.Lance.INK_WIDTH, "lance.ink.width")
        near(l["ink"]["alpha"], FieldOrb.Lance.INK_ALPHA, "lance.ink.alpha")
        assertEquals(3, l["lines"].list.size)
        for (line in l["lines"].list) {
            val zoom = line["zoom"].double!!
            val got = FieldOrb.lanceLine(FieldOrb.GALAHAD, zoom)
            val halves = line["halves"].list
            assertEquals("halves at $zoom", 2, halves.size)
            assertEquals("halves at $zoom", halves.size, got.size)
            halves.forEachIndexed { i, half ->
                Fixture.numbers(half["root"]).forEachIndexed { k, v -> Fixture.near(v, got[i].root[k], "lance at $zoom [$i].root[$k]") }
                Fixture.numbers(half["tip"]).forEachIndexed { k, v -> Fixture.near(v, got[i].tip[k], "lance at $zoom [$i].tip[$k]") }
            }
        }
        assertTrue(l["along"].list.size >= 5)
        for (a in l["along"].list) {
            val u = a["u"].double!!
            val got = FieldOrb.lanceAt(u)
            near(a["width"], got.width, "lance at u $u: width")
            near(a["light"], got.light, "lance at u $u: light")
            near(a["hue"], got.hue, "lance at u $u: hue")
        }
        val s = f["stroke"]
        near(s["least"], FieldOrb.Stroke.LEAST, "least")
        near(s["more"], FieldOrb.Stroke.MORE, "more")
        near(s["glow"]["width"], FieldOrb.Stroke.GLOW_WIDTH, "glow.width")
        near(s["glow"]["alpha"], FieldOrb.Stroke.GLOW_ALPHA, "glow.alpha")
        near(s["ink"], FieldOrb.Stroke.INK, "ink")
        near(s["light"], FieldOrb.Stroke.LIGHT, "light")
        near(s["full"], FieldOrb.Stroke.FULL, "full")
        for (l in s["lights"].list) near(l["light"], FieldOrb.strokeLight(l["size"].double!!), "light at ${l["size"].double}")
    }

    @Test fun howAFieldMovesInEachMood() {
        val motion = f["motion"].fields
        assertEquals(motion.keys, OrbMotion.Mood.entries.map { it.wire }.toSet())
        for ((name, want) in motion) assertMotion(want, FieldOrb.motion(mood(name), knight = false), "motion.$name")
        for ((name, want) in f["knightMotion"].fields) assertMotion(want, FieldOrb.motion(mood(name), knight = true), "knightMotion.$name")
        near(f["ease"], FieldOrb.EASE, "ease")
        val e = f["embers"]
        assertEquals(e["count"].int, FieldOrb.Embers.COUNT)
        for ((key, pair) in listOf("life" to (FieldOrb.Embers.LIFE_FROM to FieldOrb.Embers.LIFE_TO), "from" to (FieldOrb.Embers.FROM_FROM to FieldOrb.Embers.FROM_TO), "drift" to (FieldOrb.Embers.DRIFT_FROM to FieldOrb.Embers.DRIFT_TO), "size" to (FieldOrb.Embers.SIZE_FROM to FieldOrb.Embers.SIZE_TO))) {
            near(e[key][0], pair.first, "embers.$key[0]")
            near(e[key][1], pair.second, "embers.$key[1]")
        }
        near(e["rise"], FieldOrb.Embers.RISE, "embers.rise")
        near(e["spread"], FieldOrb.Embers.SPREAD, "embers.spread")
        near(e["rimAngle"], FieldOrb.RIM_ANGLE, "rimAngle")
    }

    @Test fun clocksStepsAndFrames() {
        for (c in f["clocks"].list) {
            val m = FieldOrb.MOTION.getValue(mood(c["mood"].string!!))
            assertClock(c["clock"], FieldOrb.clock(m), "clock ${c["mood"].string}")
            assertFrame(c["still"], FieldOrb.still(m), "still ${c["mood"].string}")
        }
        // A clock taken through moods a step at a time, his and a knight's, from idle.
        var clock: FieldOrb.Clock? = null
        var knight: Boolean? = null
        f["steps"].list.forEachIndexed { i, s ->
            val k = s["knight"].bool!!
            if (k != knight) {
                knight = k
                clock = FieldOrb.clock(FieldOrb.motion(OrbMotion.Mood.IDLE, k))
            }
            val motion = FieldOrb.motion(mood(s["mood"].string!!), k)
            clock = FieldOrb.step(clock!!, motion, s["dt"].double!!)
            assertClock(s["clock"], clock, "steps[$i]")
            assertEquals("steps[$i].fps", s["fps"].int, FieldOrb.fps(clock, motion))
        }
        f["frames"].list.forEachIndexed { i, fr ->
            val got = FieldOrb.frame(clockOf(fr["clock"]), fr["t"].double!!, fr["seed"].long!!, fr["embers"].bool!!)
            assertFrame(fr["frame"], got, "frames[$i]")
        }
    }

    @Test fun tintsToneAndInks() {
        val t = f["tints"]
        assertEquals(t["dim"].string, FieldOrb.RIM_DIM)
        for (r in t["rims"].list) {
            val rim = r["rim"].double!!
            assertEquals("aurum at $rim", colours(r["aurum"]), FieldOrb.colours(Field.AURUM, rim))
            assertEquals("gareth at $rim", colours(r["gareth"]), FieldOrb.colours(FieldOrb.knight("gareth").colours, rim))
        }
        f["tones"].list.forEachIndexed { i, c ->
            val rgb = Fixture.numbers(c["rgb"])
            val got = FieldOrb.tone(rgb[0], rgb[1], rgb[2], c["exposure"].double!!)
            Fixture.numbers(c["shown"]).forEachIndexed { k, v -> Fixture.near(v, got[k], "tones[$i][$k]") }
        }
        for (c in f["inks"].list) {
            val inks = FieldOrb.inks(colours(c["colours"]))
            assertEquals(c["inks"]["key"].list.map { it.int }, inks.key.toList())
            assertEquals(c["inks"]["rim"].list.map { it.int }, inks.rim.toList())
            for (s in c["shown"].list) {
                val ink = FieldOrb.ink(inks, s["lit"].double!!, s["rim"].double!!)
                val want = s["ink"]
                val rgb = Fixture.numbers(want["rgb"])
                Fixture.near(rgb[0], ink.r, "ink.r")
                Fixture.near(rgb[1], ink.g, "ink.g")
                Fixture.near(rgb[2], ink.b, "ink.b")
                near(want["alpha"], ink.alpha, "ink.alpha")
            }
        }
    }

    /** No line inside the core, and none where the lights leave it dark: what reads as a bright middle never is drawn. */
    @Test fun theCoreStaysDark() {
        for (identity in listOf(FieldOrb.GALAHAD, FieldOrb.knight("ada"), FieldOrb.knight("gareth"))) {
            val model = Field.model(identity.lines, 96, identity.tilt.toDoubleArray(), 1.0, identity.colours, identity.seed)
            val out = Field.buffer(model)
            for (turn in listOf(0.0, 1.0, 2.5)) {
                val count = Field.at(model, turn, out)
                assertTrue(count > 0)
                for (i in 0 until count) {
                    val r = kotlin.math.sqrt(out.x[i] * out.x[i] + out.y[i] * out.y[i] + out.z[i] * out.z[i]) / 1.05
                    assertTrue("a point inside the core at r $r", r >= 0.32 - 1e-9)
                }
            }
        }
    }
}
