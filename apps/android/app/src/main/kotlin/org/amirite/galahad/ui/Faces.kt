package org.amirite.galahad.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.amirite.galahad.app.AppModel
import org.amirite.galahad.core.Avatar
import org.amirite.galahad.core.Json
import org.amirite.galahad.core.KnightState
import org.amirite.galahad.core.NodeError
import org.amirite.galahad.core.Orb
import org.amirite.galahad.core.OrbMotion

/**
 * A knight in its seat (the PWA's seat()): its orb (KnightOrb's face: a sphere of glyphs round a bright nucleus, in the
 * colour you chose for it or its handle's; your word, 25 November 2026: "drop the knight avatars, and just use
 * custom/procedurally generated colored particle orbs") in a ring of its state's colour. [id] is its handle, [profile]
 * its saved avatar. Its orb moves in its state's mood (OrbMotion), and round the ring its state's lights move (your
 * word, 24 November 2026: "pulsing/moving when doing a task, sitting idle, waiting, done"): a light runs round it at
 * work, it beats and sends out waves while it needs you, it bursts when work is done, its motes run down when work
 * failed. Face and ring are on the one course (`seat:<handle>`), so they move as one; they are drawn as one, a frame at
 * a time, and still, once, while the phone's animations are off. A paused knight's orb is fainter. Galahad himself is
 * his orb (your word, 23 November 2026), in the colour and the mood of where he stands, as his ring's would be.
 */
@Composable
fun Face(id: String, profile: Json?, state: KnightState?, size: Dp = Space.rowFace, description: String? = null) {
    if (id == "galahad") return GalahadOrb(size, Orb.tone(state), description, mood = OrbMotion.mood(state))
    val brand = LocalBrand.current
    val ring = state?.tone?.let(brand::of)
    // The orb sits just inside the ring, the same size whatever the state: a ring coming and going never resizes it.
    val face = maxOf(size - (Space.ring + 1.dp) * 2, size / 2)
    val level = Orb.level(face.value.toDouble())
    val look = remember(id, profile, level) { KnightLook(id, profile, level) }
    val paper = onPaper()
    val mood = OrbMotion.mood(state)
    val palette = Orb.palette(Orb.tone(state))
    val course = remember(id, mood) { Courses.keep("seat:$id", mood, look.seed) }
    // As often as its mood needs: 30 a second at work or arriving at a mood, else 15.
    val time = if (motionAllowed()) frameTime { OrbMotion.fps(course.mood, level.wire, Courses.since(course)) } else null
    Box(contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(brand.raised)
                .then(if (ring != null) Modifier.border(Space.ring, ring, CircleShape) else Modifier),
        )
        // (As large as the seat and unclipped by it: its lights reach past it without moving anything round it.)
        Canvas(Modifier.size(size).then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
            val t = time?.doubleValue
            val frame = if (t != null) Courses.advance(course, t, look.seed) else OrbMotion.STILL
            // In the units of the PWA's "ring" stage: 100 is the ring's outer edge.
            val k = this.size.width / 200f
            val inner = face.toPx() / this.size.width
            withTransform({
                translate(this@Canvas.size.width / 2, this@Canvas.size.height / 2)
                scale(k, k, pivot = Offset.Zero)
            }) {
                withTransform({ scale(inner, inner, pivot = Offset.Zero) }) {
                    knight(look, frame, Moment(t ?: 0.0, if (t != null) course.mood else OrbMotion.Mood.IDLE, paper, k * inner), if (state == KnightState.PAUSED) 0.62f else 1f)
                }
                if (t != null) lights(frame, palette, Space.ring.toPx() / k.toDouble())
            }
        }
    }
}

/**
 * A seat's lights, in the units of the PWA's "ring" stage (100 is the ring's outer edge, [width] its width): the ring's
 * glow breathing (a bloom, then a closer glow), its waves, the light running round it and its motes, in its state's
 * colour, only outside the ring's inner edge, so nothing of them falls on the orb. None while the phone's animations
 * are off: the still ring says the state then, as it always has.
 */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.lights(frame: OrbMotion.Frame, palette: Orb.Palette, width: Double) {
    val r = 100 - width / 2
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

/**
 * A knight's colour, as you choose it (the PWA's avatarEditor): its orb as it will be, the 24 colours to choose from, each
 * by its name, and the one its handle gives it. Nothing is saved until you touch it: then Save sends the colour you
 * chose (`{ "v": 2, "color" }`) or, for its handle's colour, null; Cancel leaves what is saved as it was. The node takes
 * the knight's name and its avatar alone, and keeps everything else about it as it was.
 */
@Composable
fun ColourDialog(app: AppModel, id: String, name: String, profile: Json?, done: () -> Unit) {
    var chosen by remember(id) { mutableStateOf(Avatar.chosen(profile)) }
    var touched by remember(id) { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val brand = LocalBrand.current
    val shown = chosen?.let(Avatar::orbProfile)
    val handles = Avatar.KNIGHT_TINT_NAMES.getOrNull(Avatar.KNIGHT_TINTS.indexOf(Avatar.knightColors(id).tint)) ?: "this colour"
    val choose = { color: String? ->
        chosen = color
        touched = true
    }
    AlertDialog(
        onDismissRequest = done,
        title = { Text("$name's colour") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s3)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                    KnightOrb(id, shown, 96.dp, OrbMotion.moodOfExpression("idle"), "$name's orb", key = "face:$id")
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s1)) {
                        Text(
                            if (chosen != null) "The colour you chose." else "Its handle gives it $handles, the same on every device, until you choose one.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { choose(null) }) { Text("Its handle's colour") }
                    }
                }
                FlowRow(Modifier.selectableGroup()) {
                    Avatar.KNIGHT_TINTS.forEachIndexed { n, tint ->
                        val picked = chosen == tint
                        Box(
                            Modifier
                                .size(Space.touch)
                                .selectable(selected = picked, role = Role.RadioButton, onClick = { choose(tint) })
                                .semantics { contentDescription = Avatar.KNIGHT_TINT_NAMES[n] },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                Modifier.size(40.dp).then(if (picked) Modifier.border(2.dp, brand.ink, CircleShape) else Modifier),
                                contentAlignment = Alignment.Center,
                            ) { Box(Modifier.size(32.dp).clip(CircleShape).background(Color(0xff000000 or Avatar.rgb(tint)))) }
                        }
                    }
                }
                problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = brand.failed) }
            }
        },
        confirmButton = {
            TextButton(enabled = touched && !saving, onClick = {
                saving = true
                scope.launch {
                    try {
                        app.client?.post("/api/team/teammates", Json.obj("id" to id, "name" to name, "avatar" to Avatar.edited(chosen, touched)))
                        app.refresh()
                        done()
                    } catch (e: NodeError) {
                        problem = e.message
                    } finally {
                        saving = false
                    }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = done) { Text("Cancel") } },
    )
}
