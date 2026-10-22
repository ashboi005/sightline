package com.sightline.mobile.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sightline.mobile.R

/** Native equivalents of the tokens in packages/ui/src/styles/globals.css. */
@Immutable
data class SightlineColors(
    val chalk: Color,
    val ink: Color,
    val card: Color,
    val muted: Color,
    val mutedInk: Color,
    val marigoldInk: Color,
    val sage: Color,
    val sageInk: Color,
    val lilac: Color,
    val lilacInk: Color,
    val live: Color,
    val slate: Color,
    val border: Color,
    val clayTop: Color,
    val clayBottom: Color,
    val marigoldTop: Color,
    val marigoldBottom: Color,
    val sageTop: Color,
    val lilacTop: Color,
    val highlight: Color,
    val shadow: Color,
    val marigold: Color = Color(0xFFF5B301),
    val onMarigold: Color = Color(0xFF16181C),
)

private val LightColors = SightlineColors(
    chalk = Color(0xFFF3F4F1),
    ink = Color(0xFF16181C),
    card = Color.White,
    muted = Color(0xFFE9EAE6),
    mutedInk = Color(0xFF565B62),
    marigoldInk = Color(0xFF8A5A00),
    sage = Color(0xFFDFEADF),
    sageInk = Color(0xFF3D6B47),
    lilac = Color(0xFFE8E2F6),
    lilacInk = Color(0xFF5B4A8B),
    live = Color(0xFFC4321F),
    slate = Color(0xFF181C21),
    border = Color(0xFFD8DAD4),
    clayTop = Color.White,
    clayBottom = Color(0xFFF7F7F3),
    marigoldTop = Color(0xFFFFD25A),
    marigoldBottom = Color(0xFFF5B301),
    sageTop = Color(0xFFECF3EC),
    lilacTop = Color(0xFFF2EEFB),
    highlight = Color.White.copy(alpha = 0.95f),
    shadow = Color(0xFF16181C).copy(alpha = 0.16f),
)

private val DarkColors = SightlineColors(
    chalk = Color(0xFF181C21),
    ink = Color(0xFFECEDEA),
    card = Color(0xFF1F242A),
    muted = Color(0xFF242A31),
    mutedInk = Color(0xFFA3A9B1),
    marigoldInk = Color(0xFFF5B301),
    sage = Color(0xFF26352B),
    sageInk = Color(0xFFA9D1B0),
    lilac = Color(0xFF2E2940),
    lilacInk = Color(0xFFC9BDF0),
    live = Color(0xFFF07A66),
    slate = Color(0xFF12151A),
    border = Color(0xFF2E353D),
    clayTop = Color(0xFF2A3038),
    clayBottom = Color(0xFF22272E),
    marigoldTop = Color(0xFFFFCB47),
    marigoldBottom = Color(0xFFE9A900),
    sageTop = Color(0xFF2C3D31),
    lilacTop = Color(0xFF352F49),
    highlight = Color.White.copy(alpha = 0.07f),
    shadow = Color.Black.copy(alpha = 0.5f),
)

private val LocalSightlineColors = staticCompositionLocalOf { LightColors }

object SightlineTheme {
    val colors: SightlineColors
        @Composable
        @ReadOnlyComposable
        get() = LocalSightlineColors.current
}

// The app supports Android 8+; every supported version can load variable fonts.
@OptIn(ExperimentalTextApi::class)
private val Atkinson = FontFamily(
    listOf(400, 500, 600, 700, 800).map { weight ->
        Font(
            resId = R.font.atkinson_hyperlegible_next,
            weight = FontWeight(weight),
            variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
        )
    },
)

private fun textStyle(size: Int, height: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = Atkinson,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = height.sp,
    letterSpacing = 0.sp,
)

private val SightlineTypography = Typography(
    displayLarge = textStyle(44, 50, FontWeight.ExtraBold),
    displayMedium = textStyle(38, 44, FontWeight.ExtraBold),
    displaySmall = textStyle(34, 40, FontWeight.ExtraBold),
    headlineLarge = textStyle(32, 38, FontWeight.ExtraBold).copy(letterSpacing = (-0.7).sp),
    headlineMedium = textStyle(28, 34, FontWeight.ExtraBold).copy(letterSpacing = (-0.5).sp),
    headlineSmall = textStyle(24, 30, FontWeight.Bold),
    titleLarge = textStyle(20, 26, FontWeight.Bold),
    titleMedium = textStyle(18, 24, FontWeight.Bold),
    titleSmall = textStyle(16, 22, FontWeight.Bold),
    bodyLarge = textStyle(17, 26),
    bodyMedium = textStyle(16, 24),
    bodySmall = textStyle(14, 20),
    labelLarge = textStyle(16, 22, FontWeight.Bold),
    labelMedium = textStyle(14, 20, FontWeight.SemiBold),
    labelSmall = textStyle(12, 16, FontWeight.SemiBold),
)

private val SightlineShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(26.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

@Composable
fun SightlineTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    val colors = if (darkTheme) DarkColors else LightColors
    val base = if (darkTheme) darkColorScheme() else lightColorScheme()
    val scheme = base.copy(
        primary = colors.marigold,
        onPrimary = colors.onMarigold,
        primaryContainer = colors.marigold,
        onPrimaryContainer = colors.onMarigold,
        inversePrimary = colors.marigoldInk,
        secondary = colors.sageInk,
        onSecondary = colors.card,
        secondaryContainer = colors.sage,
        onSecondaryContainer = colors.sageInk,
        tertiary = colors.lilacInk,
        onTertiary = colors.card,
        tertiaryContainer = colors.lilac,
        onTertiaryContainer = colors.lilacInk,
        background = colors.chalk,
        onBackground = colors.ink,
        surface = colors.card,
        onSurface = colors.ink,
        surfaceVariant = colors.muted,
        onSurfaceVariant = colors.mutedInk,
        surfaceTint = Color.Transparent,
        inverseSurface = if (darkTheme) LightColors.chalk else LightColors.ink,
        inverseOnSurface = if (darkTheme) LightColors.ink else DarkColors.ink,
        error = colors.live,
        onError = if (darkTheme) colors.onMarigold else Color.White,
        errorContainer = colors.live.copy(alpha = 0.12f).compositeOver(colors.card),
        onErrorContainer = colors.live,
        outline = colors.mutedInk,
        outlineVariant = colors.border,
        scrim = Color.Black,
        surfaceBright = colors.clayTop,
        surfaceDim = colors.chalk,
        surfaceContainerLowest = colors.chalk,
        surfaceContainerLow = colors.card,
        surfaceContainer = colors.card,
        surfaceContainerHigh = colors.clayTop,
        surfaceContainerHighest = colors.muted,
    )
    CompositionLocalProvider(LocalSightlineColors provides colors) {
        MaterialTheme(
            colorScheme = scheme,
            typography = SightlineTypography,
            shapes = SightlineShapes,
            content = content,
        )
    }
}
