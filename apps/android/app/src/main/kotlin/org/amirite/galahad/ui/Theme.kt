package org.amirite.galahad.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.amirite.galahad.core.KnightState

/*
 * Galahad's look on Android: Android's own components, with Galahad's accents, as the Apple app is Apple's with them.
 * The colours are the brand's, never the wallpaper's (apps/web/src/brand.ts INK, the Apple app's asset catalog and
 * Brand.swift): ink on paper, cream on the dark, the Siege Perilous red, and one colour a state (blue at work, amber
 * needs you, red failed, green done). Nothing moves by itself: a state is a still ring and a word, never a spinner (the
 * owner's word, 18 Nov). What moves answers you: a page opening or closing.
 */

@Immutable
data class Brand(
    val ink: Color,
    val onInk: Color,
    val paper: Color,
    val raised: Color,
    val line: Color,
    val quiet: Color,
    val siege: Color,
    val working: Color,
    val needs: Color,
    val failed: Color,
    val done: Color,
) {
    fun of(tone: KnightState.Tone): Color? = when (tone) {
        KnightState.Tone.WORK -> working
        KnightState.Tone.NEEDS -> needs
        KnightState.Tone.FAILED -> failed
        KnightState.Tone.OK -> done
        KnightState.Tone.NEUTRAL -> null
    }
}

private val Light = Brand(
    ink = Color(0xFF0A0A0B), onInk = Color(0xFFF8EBDC), paper = Color(0xFFFFFFFF), raised = Color(0xFFF4F4F5), line = Color(0x1F0A0A0B),
    quiet = Color(0xFF5E5E66), siege = Color(0xFFC4141B), working = Color(0xFF0A5FCC), needs = Color(0xFF946200), failed = Color(0xFFC4141B),
    done = Color(0xFF137A43),
)

private val Dark = Brand(
    ink = Color(0xFFF8EBDC), onInk = Color(0xFF0A0A0B), paper = Color(0xFF141416), raised = Color(0xFF1E1E21), line = Color(0x24F8EBDC),
    quiet = Color(0xFFA3A3AB), siege = Color(0xFFEE2C36), working = Color(0xFF58A6FF), needs = Color(0xFFF0B549), failed = Color(0xFFFF6B6B),
    done = Color(0xFF4CC38A),
)

val LocalBrand = staticCompositionLocalOf { Light }

/** The spacing scale (the PWA's --sp-*, Brand.swift's Space), in dp. */
object Space {
    val s1 = 4.dp
    val s2 = 8.dp
    val s3 = 12.dp
    val s4 = 16.dp
    val s6 = 24.dp
    val s10 = 40.dp
    val margin = 16.dp
    val rowFace = 56.dp
    val ring = 3.dp
    val touch = 48.dp
}

@Composable
fun GalahadTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val b = if (dark) Dark else Light
    val scheme = if (dark) {
        darkColorScheme(
            primary = b.ink, onPrimary = b.onInk, secondary = b.ink, onSecondary = b.onInk, background = b.paper, onBackground = b.ink,
            surface = b.paper, onSurface = b.ink, surfaceVariant = b.raised, onSurfaceVariant = b.quiet, surfaceContainer = b.raised,
            surfaceContainerHigh = b.raised, surfaceContainerLow = b.paper, outline = b.line, outlineVariant = b.line, error = b.failed,
            secondaryContainer = b.raised, onSecondaryContainer = b.ink,
        )
    } else {
        lightColorScheme(
            primary = b.ink, onPrimary = b.onInk, secondary = b.ink, onSecondary = b.onInk, background = b.paper, onBackground = b.ink,
            surface = b.paper, onSurface = b.ink, surfaceVariant = b.raised, onSurfaceVariant = b.quiet, surfaceContainer = b.raised,
            surfaceContainerHigh = b.raised, surfaceContainerLow = b.paper, outline = b.line, outlineVariant = b.line, error = b.failed,
            secondaryContainer = b.raised, onSecondaryContainer = b.ink,
        )
    }
    val shapes = Shapes(small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(20.dp))
    CompositionLocalProvider(LocalBrand provides b) {
        MaterialTheme(colorScheme = scheme, shapes = shapes, content = content)
    }
}
