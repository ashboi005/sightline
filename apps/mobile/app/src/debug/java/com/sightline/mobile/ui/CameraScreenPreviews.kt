package com.sightline.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.sightline.mobile.CaptureUiState
import com.sightline.mobile.camera.CameraSource
import com.sightline.mobile.camera.CameraKind
import com.sightline.mobile.stream.ChannelInfo

// Sample devices exist only in debug previews. Runtime discovery always uses the camera service.
private val previewCameras = listOf(
    CameraSource("phone-30", "Rear camera (0)", "Built-in phone camera", kind = CameraKind.PHONE),
    CameraSource("usb-2", "USB webcam", "USB camera · 1bcf:2c99"),
)

@Composable
private fun StudioPreview(state: CaptureUiState = CaptureUiState(scanComplete = true), dark: Boolean = false) {
    CameraScreen(state, ready = true, permissionError = null,
        onScan = {}, onStart = { _, _ -> }, onStop = {}, onCopy = {}, onShare = {}, darkTheme = dark)
}

@Preview(name = "Empty · light", widthDp = 390, heightDp = 844, showBackground = true)
@Composable
fun EmptyStudioPreview() = StudioPreview()

@Preview(name = "Two attached · light", widthDp = 390, heightDp = 844)
@Composable
fun ConnectedStudioPreview() = StudioPreview(CaptureUiState(cameras = previewCameras, scanComplete = true))

@Preview(name = "Two live · sample data", widthDp = 390, heightDp = 844)
@Composable
fun LiveStudioPreview() = StudioPreview(CaptureUiState(
    cameras = previewCameras.map { it.copy(status = "Streaming at 640 × 480", streaming = true) },
    running = true, scanComplete = true, addresses = listOf("http://192.168.1.42:8080"),
    channels = previewCameras.map { ChannelInfo(it.id, it.name, 1240, 1L) },
))

@Preview(name = "Empty · dark", widthDp = 390, heightDp = 844)
@Composable
fun DarkStudioPreview() = StudioPreview(dark = true)

@Preview(name = "Large text · narrow phone", widthDp = 360, heightDp = 800, fontScale = 2f)
@Composable
fun LargeTextStudioPreview() = StudioPreview()

@Preview(name = "Landscape", widthDp = 844, heightDp = 390)
@Composable
fun LandscapeStudioPreview() = StudioPreview()
