package com.sightline.mobile.camera

import android.content.Context
import com.sightline.mobile.stream.FrameHub

/** Combines discovery and batch completion without making either backend own the other. */
class CameraCoordinator(
    context: Context,
    hub: FrameHub,
    private val onChanged: (List<CameraSource>, Boolean, String?) -> Unit,
) {
    private val lock = Any()
    private var phoneSources = emptyList<CameraSource>()
    private var usbSources = emptyList<CameraSource>()
    private var phoneScanned = false
    private var usbScanned = false
    private var phoneNotice: String? = null
    private var epoch = 0L
    private var closed = false
    private var pendingBackends = mutableSetOf<CameraKind>()
    private var onFinished: (() -> Unit)? = null
    private val phone = PhoneCameraEngine(context, hub) { sources, notice ->
        synchronized(lock) {
            phoneSources = sources; phoneScanned = true; phoneNotice = notice; emit()
        }
    }
    private val usb = UsbCameraEngine(context, hub) { sources ->
        synchronized(lock) { usbSources = sources; usbScanned = true; emit() }
    }

    fun scan() { phone.scan(); usb.scan() }

    fun start(ids: List<String>, settings: CaptureSettings, finished: () -> Unit) {
        settings.validate()
        val chosen = synchronized(lock) {
            check(!closed)
            val sources = (phoneSources + usbSources).associateBy { it.id }
            ids.distinct().map { sources[it] ?: error("A selected camera is no longer available. Refresh and select it again.") }
        }
        require(chosen.size in 1..5) { "Select between one and five cameras." }
        val phoneIds = chosen.filter { it.kind == CameraKind.PHONE }.map { it.id }
        val usbIds = chosen.filter { it.kind == CameraKind.USB }.map { it.id }
        if (phoneIds.isNotEmpty()) phone.selectionError(phoneIds)?.let { error(it) }
        stop()
        val token = synchronized(lock) {
            pendingBackends = chosen.map { it.kind }.toMutableSet()
            onFinished = finished
            epoch
        }
        try {
            if (phoneIds.isNotEmpty()) phone.start(phoneIds, settings) { backendFinished(token, CameraKind.PHONE) }
            if (usbIds.isNotEmpty()) usb.start(usbIds, settings) { backendFinished(token, CameraKind.USB) }
        } catch (error: Exception) { stop(); throw error }
    }

    fun stop() {
        synchronized(lock) { epoch++; pendingBackends.clear(); onFinished = null }
        phone.stop(); usb.stop()
    }

    fun close() {
        synchronized(lock) { closed = true; epoch++; pendingBackends.clear(); onFinished = null }
        phone.close(); usb.close()
    }

    private fun backendFinished(token: Long, kind: CameraKind) {
        val callback = synchronized(lock) {
            if (closed || token != epoch) return
            pendingBackends.remove(kind)
            if (pendingBackends.isEmpty()) onFinished.also { onFinished = null } else null
        }
        callback?.invoke()
    }

    /** Called with lock held; publishing a single snapshot prevents lost discovery updates. */
    private fun emit() {
        if (!closed) onChanged(phoneSources + usbSources, phoneScanned && usbScanned, phoneNotice)
    }
}
