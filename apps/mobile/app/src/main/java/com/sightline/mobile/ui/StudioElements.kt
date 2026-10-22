package com.sightline.mobile.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal enum class StudioIcon { Camera, Refresh, Chevron, Sun, Moon, Check, Link, Copy, Share, Play, Stop, Monitor, Info }

/** Small, consistent 24-unit line icons. Labels belong to the surrounding native control. */
@Composable
internal fun StudioGlyph(icon: StudioIcon, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    Canvas(modifier.size(24.dp)) {
        scale(size.width / 24f, size.height / 24f, Offset.Zero) {
            val stroke = Stroke(1.8f, cap = StrokeCap.Round)
            fun line(x: Float, y: Float, xx: Float, yy: Float) = drawLine(color, Offset(x, y), Offset(xx, yy), 1.8f, StrokeCap.Round)
            fun path(vararg points: Float) = drawPath(Path().apply {
                moveTo(points[0], points[1]); for (i in 2 until points.size step 2) lineTo(points[i], points[i + 1])
            }, color, style = stroke)
            when (icon) {
                StudioIcon.Camera -> {
                    drawRoundRect(color, Offset(2f, 5f), Size(15f, 14f), CornerRadius(3f), style = stroke)
                    path(17f, 9f, 22f, 6f, 22f, 18f, 17f, 15f)
                    drawCircle(color, 3f, Offset(9.5f, 12f), style = stroke)
                }
                StudioIcon.Refresh -> { drawArc(color, 40f, 280f, false, Offset(4f, 4f), Size(16f, 16f), style = stroke); path(15f, 4f, 20f, 4f, 20f, 9f) }
                StudioIcon.Chevron -> path(7f, 10f, 12f, 15f, 17f, 10f)
                StudioIcon.Check -> path(5f, 12f, 10f, 17f, 19f, 7f)
                StudioIcon.Sun -> {
                    drawCircle(color, 4f, Offset(12f, 12f), style = stroke)
                    line(12f, 1f, 12f, 3f); line(12f, 21f, 12f, 23f); line(1f, 12f, 3f, 12f); line(21f, 12f, 23f, 12f)
                    line(4f, 4f, 5.5f, 5.5f); line(18.5f, 18.5f, 20f, 20f); line(4f, 20f, 5.5f, 18.5f); line(18.5f, 5.5f, 20f, 4f)
                }
                StudioIcon.Moon -> drawPath(Path().apply { moveTo(20f, 14f); cubicTo(12f, 17f, 7f, 10f, 10f, 3f); cubicTo(-1f, 6f, 3f, 23f, 14f, 21f); cubicTo(17f, 20f, 19f, 18f, 20f, 14f) }, color, style = stroke)
                StudioIcon.Link -> { drawRoundRect(color, Offset(2f, 8f), Size(9f, 8f), CornerRadius(4f), style = stroke); drawRoundRect(color, Offset(13f, 8f), Size(9f, 8f), CornerRadius(4f), style = stroke); line(8f, 12f, 16f, 12f) }
                StudioIcon.Copy -> { drawRoundRect(color, Offset(8f, 8f), Size(12f, 13f), CornerRadius(2f), style = stroke); path(15f, 4f, 4f, 4f, 4f, 16f) }
                StudioIcon.Share -> { listOf(Offset(5f, 12f), Offset(19f, 5f), Offset(19f, 19f)).forEach { drawCircle(color, 3f, it, style = stroke) }; line(8f, 10.5f, 16f, 6.5f); line(8f, 13.5f, 16f, 17.5f) }
                StudioIcon.Play -> drawPath(Path().apply { moveTo(7f, 4f); lineTo(20f, 12f); lineTo(7f, 20f); close() }, color)
                StudioIcon.Stop -> drawRoundRect(color, Offset(5f, 5f), Size(14f, 14f), CornerRadius(3f))
                StudioIcon.Monitor -> { drawRoundRect(color, Offset(2f, 3f), Size(20f, 14f), CornerRadius(2f), style = stroke); line(12f, 17f, 12f, 21f); line(7f, 21f, 17f, 21f) }
                StudioIcon.Info -> { drawCircle(color, 9f, Offset(12f, 12f), style = stroke); drawCircle(color, 1f, Offset(12f, 8f)); line(12f, 12f, 12f, 16f) }
            }
        }
    }
}

/** Exact proportions of the web app's gaze-point logo. */
@Composable
internal fun SightlineMark(modifier: Modifier = Modifier) {
    val colors = SightlineTheme.colors
    Canvas(modifier.size(40.dp)) {
        scale(size.width / 32f, size.height / 32f, Offset.Zero) {
            drawRoundRect(colors.ink, size = Size(32f, 32f), cornerRadius = CornerRadius(8f))
            drawRoundRect(colors.chalk, Offset(7f, 19f), Size(18f, 2.5f), CornerRadius(1.25f))
            drawCircle(colors.marigold, 4f, Offset(19f, 12.5f))
        }
    }
}

internal enum class ClayTone { Plain, Sage, Lilac }

@Composable
internal fun ClayPanel(
    modifier: Modifier = Modifier,
    tone: ClayTone = ClayTone.Plain,
    radius: Dp = 28.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = SightlineTheme.colors
    val (top, bottom) = when (tone) {
        ClayTone.Plain -> colors.clayTop to colors.clayBottom
        ClayTone.Sage -> colors.sageTop to colors.sage
        ClayTone.Lilac -> colors.lilacTop to colors.lilac
    }
    val shape = RoundedCornerShape(radius)
    Column(modifier.fillMaxWidth()
        .shadow(5.dp, shape, ambientColor = colors.shadow, spotColor = colors.shadow)
        .clip(shape)
        .background(Brush.verticalGradient(listOf(top, bottom)))
        .border(1.dp, Brush.verticalGradient(listOf(colors.highlight, colors.border.copy(alpha = 0.35f))), shape)
        .padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

@Composable
internal fun StatusPill(text: String, live: Boolean = false, working: Boolean = false) {
    val colors = SightlineTheme.colors
    val foreground = if (live) colors.live else if (working) colors.lilacInk else colors.sageInk
    val background = if (live) colors.live.copy(alpha = 0.1f) else if (working) colors.lilac else colors.sage
    Row(Modifier.clip(RoundedCornerShape(8.dp)).background(background).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (live) Canvas(Modifier.size(8.dp)) { drawCircle(foreground) }
        else StudioGlyph(if (working) StudioIcon.Info else StudioIcon.Check, Modifier.size(16.dp), foreground)
        Text(text, style = MaterialTheme.typography.labelMedium, color = foreground)
    }
}

/** A connection diagram for the empty state, never a simulated camera feed. */
@Composable
internal fun HubIllustration(modifier: Modifier = Modifier) {
    val colors = SightlineTheme.colors
    Canvas(modifier.fillMaxWidth().height(108.dp)) {
        val factor = minOf(size.width / 280f, size.height / 108f)
        translate((size.width - 280f * factor) / 2f, 0f) {
            scale(factor, factor, Offset.Zero) {
                val stroke = Stroke(2f, cap = StrokeCap.Round)
                drawPath(Path().apply { moveTo(56f, 50f); lineTo(56f, 72f); quadraticTo(56f, 80f, 64f, 80f); lineTo(216f, 80f); quadraticTo(224f, 80f, 224f, 72f); lineTo(224f, 50f) }, colors.sageInk.copy(alpha = 0.6f), style = stroke)
                drawLine(colors.sageInk, Offset(140f, 61f), Offset(140f, 101f), 2f, StrokeCap.Round)
                listOf(26f, 194f).forEach { x ->
                    drawRoundRect(colors.card, Offset(x, 6f), Size(60f, 46f), CornerRadius(15f))
                    drawRoundRect(colors.sageInk, Offset(x + 12f, 17f), Size(29f, 23f), CornerRadius(6f), style = stroke)
                    drawCircle(colors.sageInk, 5f, Offset(x + 26f, 28f), style = stroke)
                    drawPath(Path().apply { moveTo(x + 41f, 23f); lineTo(x + 49f, 18f); lineTo(x + 49f, 38f); lineTo(x + 41f, 33f) }, colors.sageInk, style = stroke)
                }
                drawRoundRect(colors.marigold, Offset(119f, 56f), Size(42f, 31f), CornerRadius(10f))
                listOf(130f, 140f, 150f).forEach { x -> drawCircle(colors.onMarigold, 2f, Offset(x, 71f)) }
                drawRoundRect(colors.sageInk, Offset(134f, 98f), Size(12f, 7f), CornerRadius(3f))
            }
        }
    }
}
