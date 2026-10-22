package com.sightline.mobile.camera

data class CaptureSettings(
    val width: Int = 640,
    val height: Int = 480,
    val fps: Int = 20,
    val jpegQuality: Int = 75,
) {
    internal fun validate() {
        require(width > 0 && height > 0 && width % 2 == 0 && height % 2 == 0) {
            "Capture dimensions must be positive, even numbers."
        }
        require(fps in 1..60) { "Output frame rate must be between 1 and 60 FPS." }
        require(jpegQuality in 1..100) { "JPEG quality must be between 1 and 100." }
    }
}

internal enum class CaptureFormat { MJPEG, YUYV }

internal data class CameraMode(
    val width: Int,
    val height: Int,
    val format: CaptureFormat,
    val defaultFps: Int,
    val supportedFps: List<Int>?,
)

internal data class SelectedCameraMode(
    val width: Int,
    val height: Int,
    val format: CaptureFormat,
    val fps: Int,
)

/** Chooses only advertised modes; MJPEG minimizes the shared USB hub's bandwidth. */
internal fun selectCameraMode(modes: List<CameraMode>, settings: CaptureSettings): SelectedCameraMode {
    settings.validate()
    return modes.asSequence()
        .filter {
            it.width in 1..settings.width && it.height in 1..settings.height &&
                it.width % 2 == 0 && it.height % 2 == 0
        }
        .mapNotNull { mode ->
            val rates = (mode.supportedFps.orEmpty() + mode.defaultFps).filter { it > 0 }
            // Input must meet the output target; e.g. use 30 FPS instead of 15 for a 20 FPS stream.
            val fps = rates.filter { it >= settings.fps }.minOrNull() ?: rates.maxOrNull()
            fps?.let { SelectedCameraMode(mode.width, mode.height, mode.format, it) }
        }
        .sortedWith(
            compareBy<SelectedCameraMode> { if (it.format == CaptureFormat.MJPEG) 0 else 1 }
                .thenByDescending { it.width.toLong() * it.height }
                .thenBy { kotlin.math.abs(it.fps - settings.fps) },
        )
        .firstOrNull()
        ?: throw IllegalArgumentException(
            "No supported MJPEG or YUYV mode at or below ${settings.width} × ${settings.height}. " +
                "Try a larger resolution limit or another UVC camera.",
        )
}
