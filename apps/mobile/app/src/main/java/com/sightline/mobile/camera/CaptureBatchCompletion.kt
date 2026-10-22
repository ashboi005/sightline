package com.sightline.mobile.camera

/** Control-thread state: a completed or canceled batch must never retain its callback. */
internal class CaptureBatchCompletion {
    private var onFinished: (() -> Unit)? = null

    fun begin(callback: () -> Unit) {
        onFinished = callback
    }

    fun cancel() {
        onFinished = null
    }

    fun takeIfFinished(
        hasSessions: Boolean,
        hasCurrentPermission: Boolean,
        hasQueuedCameras: Boolean,
        isOpening: Boolean,
    ): (() -> Unit)? {
        if (hasSessions || hasCurrentPermission || hasQueuedCameras || isOpening) return null
        return onFinished.also { onFinished = null }
    }
}
