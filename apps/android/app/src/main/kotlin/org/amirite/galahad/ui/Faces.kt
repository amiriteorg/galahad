package org.amirite.galahad.ui

import android.content.Context
import android.graphics.BitmapFactory
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
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.amirite.galahad.core.KnightState

/**
 * The knights as the owner drew them: the PWA's own WebP files, packaged as they are (never redrawn or recoloured), read
 * once each and kept. The @2x drawing for a face of 120 dp or more, as the Apple app does.
 */
object Drawings {
    private val kept = HashMap<String, ImageBitmap>()

    fun of(context: Context, name: String): ImageBitmap? = synchronized(kept) {
        kept[name] ?: runCatching {
            context.assets.open("$name.webp").use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
        }.getOrNull()?.also { kept[name] = it }
    }
}

private val paused = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.15f) })

/**
 * A face in its state's ring: still, never pulsing. A paused knight is drawn faded (saturation 0.15, opacity 0.62, as
 * the Apple app draws it). [drawing] is the look's name (`gareth`), `galahad`, or `black-knight`.
 */
@Composable
fun Face(drawing: String, state: KnightState?, size: Dp = Space.rowFace, description: String? = null) {
    val context = LocalContext.current
    val brand = LocalBrand.current
    val name = if (size >= 120.dp && (drawing == "galahad" || drawing == "black-knight")) "$drawing@2x" else drawing
    val image = remember(name) { Drawings.of(context, name) }
    val ring = state?.tone?.let(brand::of)
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
}
