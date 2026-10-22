package com.sightline.mobile.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CameraModeSelectorTest {
    @Test
    fun prefersMjpegToUncompressedForHubBandwidth() {
        val selected = selectCameraMode(
            listOf(
                CameraMode(640, 480, CaptureFormat.YUYV, 30, listOf(10, 30)),
                CameraMode(320, 240, CaptureFormat.MJPEG, 30, listOf(10, 30)),
            ),
            CaptureSettings(),
        )

        assertEquals(SelectedCameraMode(320, 240, CaptureFormat.MJPEG, 30), selected)
    }

    @Test
    fun selectsLargestSupportedSizeWithinBothRequestedDimensions() {
        val selected = selectCameraMode(
            listOf(
                CameraMode(1280, 720, CaptureFormat.MJPEG, 30, listOf(30)),
                CameraMode(800, 360, CaptureFormat.MJPEG, 10, listOf(10)),
                CameraMode(320, 240, CaptureFormat.MJPEG, 10, listOf(10)),
                CameraMode(640, 480, CaptureFormat.MJPEG, 10, listOf(10)),
            ),
            CaptureSettings(),
        )

        assertEquals(SelectedCameraMode(640, 480, CaptureFormat.MJPEG, 10), selected)
    }

    @Test
    fun usesLowestAdvertisedRateThatMeetsRequestedRate() {
        val selected = selectCameraMode(
            listOf(CameraMode(640, 480, CaptureFormat.MJPEG, 30, listOf(5, 15, 30))),
            CaptureSettings(fps = 20),
        )

        assertEquals(30, selected.fps)
    }

    @Test
    fun usesLowestAdvertisedRateWhenEveryRateExceedsOutputRate() {
        val selected = selectCameraMode(
            listOf(CameraMode(640, 480, CaptureFormat.MJPEG, 30, listOf(15, 30))),
            CaptureSettings(fps = 10),
        )

        assertEquals(15, selected.fps)
    }

    @Test
    fun usesDescriptorDefaultWhenRateListIsMissing() {
        val selected = selectCameraMode(
            listOf(CameraMode(640, 480, CaptureFormat.YUYV, 25, null)),
            CaptureSettings(),
        )

        assertEquals(SelectedCameraMode(640, 480, CaptureFormat.YUYV, 25), selected)
    }

    @Test
    fun refusesOversizedModesInsteadOfInventingAResolution() {
        assertThrows(IllegalArgumentException::class.java) {
            selectCameraMode(
                listOf(CameraMode(1280, 720, CaptureFormat.MJPEG, 30, listOf(30))),
                CaptureSettings(),
            )
        }
    }

    @Test
    fun skipsModesWithoutAValidFrameRateOrEvenDimensions() {
        val selected = selectCameraMode(
            listOf(
                CameraMode(640, 480, CaptureFormat.MJPEG, 0, listOf(0, -1)),
                CameraMode(639, 479, CaptureFormat.MJPEG, 30, listOf(30)),
                CameraMode(320, 240, CaptureFormat.YUYV, 15, emptyList()),
            ),
            CaptureSettings(),
        )

        assertEquals(SelectedCameraMode(320, 240, CaptureFormat.YUYV, 15), selected)
    }

    @Test
    fun rejectsEmptyCapabilities() {
        assertThrows(IllegalArgumentException::class.java) {
            selectCameraMode(emptyList(), CaptureSettings())
        }
    }
}
