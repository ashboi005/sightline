package com.sightline.mobile.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureBatchCompletionTest {
    @Test
    fun waitsForEverySourceOfOutstandingCaptureWork() {
        for (blocker in 0..3) {
            val batch = CaptureBatchCompletion()
            batch.begin {}

            assertNull(batch.takeIfFinished(
                hasSessions = blocker == 0,
                hasCurrentPermission = blocker == 1,
                hasQueuedCameras = blocker == 2,
                isOpening = blocker == 3,
            ))
        }
    }

    @Test
    fun completesAnExhaustedBatchExactlyOnce() {
        var finished = 0
        val batch = CaptureBatchCompletion()
        batch.begin { finished += 1 }

        batch.takeIfFinished(false, false, false, false)?.invoke()
        batch.takeIfFinished(false, false, false, false)?.invoke()

        assertEquals(1, finished)
    }

    @Test
    fun explicitStopDoesNotCompleteTheBatch() {
        var finished = 0
        val batch = CaptureBatchCompletion()
        batch.begin { finished += 1 }
        batch.cancel()

        batch.takeIfFinished(false, false, false, false)?.invoke()

        assertEquals(0, finished)
    }

    @Test
    fun replacementStartOnlyCompletesItsOwnCallback() {
        var oldFinished = 0
        var newFinished = 0
        val batch = CaptureBatchCompletion()
        batch.begin { oldFinished += 1 }
        batch.begin { newFinished += 1 }

        batch.takeIfFinished(false, false, false, false)?.invoke()

        assertEquals(0, oldFinished)
        assertEquals(1, newFinished)
    }

    @Test
    fun temporaryBusyStateKeepsTheCompletionCallback() {
        var finished = 0
        val batch = CaptureBatchCompletion()
        batch.begin { finished += 1 }

        batch.takeIfFinished(false, true, false, false)?.invoke()
        assertEquals(0, finished)
        batch.takeIfFinished(false, false, false, false)?.invoke()

        assertEquals(1, finished)
    }
}
