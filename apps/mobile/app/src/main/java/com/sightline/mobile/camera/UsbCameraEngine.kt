package com.sightline.mobile.camera

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import com.serenegiant.usb.DeviceFilter
import com.serenegiant.usb.Size
import com.serenegiant.usb.USBMonitor
import com.serenegiant.usb.UVCCamera
import com.serenegiant.usb.UVCParam
import com.sightline.mobile.stream.FrameHub
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns USB permission, native UVC handles, and JPEG production for up to five cameras.
 * Operations run on a serial control thread. onChanged also runs on that thread.
 * The activity must grant Android's CAMERA permission before calling start().
 */
class UsbCameraEngine(
    context: Context,
    private val hub: FrameHub,
    private val onChanged: (List<CameraSource>) -> Unit,
) {
    private val appContext = context.applicationContext
    private val usbManager = appContext.getSystemService(UsbManager::class.java)
    private val controlThread = HandlerThread("Sightline-USB").apply { start() }
    private val control = Handler(controlThread.looper)
    // A native stop can wait for its preview surface. Drain it independently of stop().
    private val surfaceThread = HandlerThread("Sightline-Surfaces").apply { start() }
    private val surfaces = Handler(surfaceThread.looper)
    private val encoders = ThreadPoolExecutor(
        2, 2, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(5),
        { task -> Thread(task, "Sightline-JPEG") },
        ThreadPoolExecutor.AbortPolicy(),
    )
    private val closing = AtomicBoolean(false)
    private val devices = linkedMapOf<String, UsbDevice>()
    private val info = linkedMapOf<String, CameraSource>()
    private val sessions = mutableMapOf<String, CameraSession>()
    private val openQueue = ArrayDeque<String>()
    private var monitor: USBMonitor? = null
    private var generation = 0L
    private var requestedSettings = CaptureSettings()
    private var permissionRequest: PermissionRequest? = null
    private val batchCompletion = CaptureBatchCompletion()
    private var openingCamera = false

    private data class PermissionRequest(
        val id: String,
        val device: UsbDevice,
        val generation: Long,
    )

    private class CameraSession(
        val id: String,
        val camera: UVCCamera,
        val controlBlock: USBMonitor.UsbControlBlock,
        val reader: ImageReader,
        val mode: SelectedCameraMode,
        val settings: CaptureSettings,
    ) {
        val active = AtomicBoolean(true)
        val encoding = AtomicBoolean(false)
        val firstFrame = AtomicBoolean(false)
        val failureReported = AtomicBoolean(false)
        val nextFrameAt = AtomicLong(0)
        val lastFrameAt = AtomicLong(SystemClock.elapsedRealtime())
        val publicationLock = Any()
        var watchdog: Runnable? = null
    }

    private val listener = object : USBMonitor.OnDeviceConnectListener {
        override fun onAttach(device: UsbDevice) {
            if (!closing.get()) refreshDevices()
        }

        override fun onDetach(device: UsbDevice) {
            if (closing.get()) return
            val id = deviceId(device)
            closeSession(id)
            devices.remove(id)
            info.remove(id)
            openQueue.remove(id)
            if (permissionRequest?.matches(device) == true) permissionRequest = null
            emit()
            requestNextPermission()
        }

        override fun onDeviceOpen(
            device: UsbDevice,
            ctrlBlock: USBMonitor.UsbControlBlock,
            createNew: Boolean,
        ) {
            val request = permissionRequest
            if (request == null || !request.matches(device)) {
                release("unused USB permission") { ctrlBlock.close(true) }
                return
            }
            permissionRequest = null
            if (!closing.get() && request.generation == generation && devices.containsKey(request.id)) {
                openingCamera = true
                try {
                    openCamera(request.id, ctrlBlock)
                } finally {
                    openingCamera = false
                }
            } else {
                release("canceled USB permission") { ctrlBlock.close(true) }
            }
            requestNextPermission()
        }

        override fun onCancel(device: UsbDevice) {
            finishPermissionFailure(device, "USB permission denied. Tap Start to try again.")
        }

        override fun onError(device: UsbDevice, error: USBMonitor.USBException) {
            finishPermissionFailure(device, "USB access failed: ${error.description()}")
        }

        override fun onDeviceClose(device: UsbDevice?, ctrlBlock: USBMonitor.UsbControlBlock) {
            if (closing.get() || device == null) return
            val id = deviceId(device)
            // An old native handle may close after a new start; compare the actual handle.
            if (sessions[id]?.controlBlock === ctrlBlock) {
                failSession(id, "USB connection closed. Check the hub power and reconnect the camera.")
            }
        }
    }

    init {
        scan()
    }

    fun scan() {
        if (closing.get()) return
        control.post {
            if (!closing.get()) {
                ensureMonitor()
                refreshDevices()
            }
        }
    }

    /** onFinished runs once on the control thread if this batch exhausts all cameras. */
    fun start(ids: List<String>, settings: CaptureSettings, onFinished: () -> Unit = {}) {
        val selected = ids.distinct()
        require(selected.isNotEmpty()) { "Select at least one USB camera." }
        require(selected.size <= 5) { "Select no more than five USB cameras." }
        settings.validate()
        check(!closing.get()) { "The USB camera engine is closed." }
        control.post {
            if (closing.get()) return@post
            stopCapture()
            refreshDevices()
            requestedSettings = settings
            batchCompletion.begin(onFinished)
            if (!ensureMonitor()) {
                finishBatchIfIdle()
                return@post
            }
            selected.forEach { id ->
                if (devices.containsKey(id)) {
                    setStatus(id, "Waiting for USB permission")
                    openQueue.addLast(id)
                } else {
                    info[id] = CameraSource(
                        id, "Disconnected camera", "This camera is no longer attached.", "Disconnected",
                    )
                }
            }
            if (permissionRequest != null) {
                selected.forEach { setStatus(it, "Finish the previous USB permission prompt to continue") }
            }
            emit()
            requestNextPermission()
        }
    }

    fun stop() {
        if (closing.get()) return
        control.post {
            if (!closing.get()) {
                stopCapture()
                emit()
            }
        }
    }

    fun close() {
        if (!closing.compareAndSet(false, true)) return
        control.post {
            stopCapture()
            release("USB monitor") { monitor?.destroy() }
            monitor = null
            permissionRequest = null
            encoders.shutdownNow()
            surfaceThread.quitSafely()
            controlThread.quitSafely()
        }
    }

    private fun ensureMonitor(): Boolean {
        if (monitor != null) return true
        if (usbManager == null || !appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST)) return false
        var candidate: USBMonitor? = null
        return try {
            candidate = USBMonitor(appContext, listener, control)
            candidate.setDeviceFilter(DeviceFilter(-1, -1, UsbConstants.USB_CLASS_VIDEO, -1, -1, null, null, null))
            candidate.register()
            monitor = candidate
            true
        } catch (error: Exception) {
            release("failed USB monitor") { candidate?.destroy() }
            devices.values.forEach { device ->
                val id = deviceId(device)
                info.putIfAbsent(id, cameraInfo(device))
                setStatus(id, "USB monitoring failed: ${error.description()}")
            }
            emit()
            false
        }
    }

    private fun refreshDevices() {
        val attached = usbManager?.deviceList.orEmpty().values.filter(::isVideoDevice).associateBy(::deviceId)
        for (id in devices.keys.toList()) {
            if (id !in attached) {
                closeSession(id)
                devices.remove(id)
                info.remove(id)
                openQueue.remove(id)
                if (permissionRequest?.id == id) permissionRequest = null
            }
        }
        for ((id, device) in attached) {
            devices[id] = device
            info.putIfAbsent(id, cameraInfo(device))
        }
        info.keys.retainAll(attached.keys)
        emit()
        requestNextPermission()
    }

    private fun requestNextPermission() {
        if (closing.get()) return
        if (permissionRequest != null) {
            finishBatchIfIdle()
            return
        }
        while (openQueue.isNotEmpty()) {
            val id = openQueue.removeFirst()
            val device = devices[id] ?: continue
            permissionRequest = PermissionRequest(id, device, generation)
            setStatus(id, "Allow USB access in the Android prompt")
            emit()
            try {
                checkNotNull(monitor).requestPermission(device)
            } catch (error: Exception) {
                permissionRequest = null
                setStatus(id, "USB permission request failed: ${error.description()}")
                emit()
                continue
            }
            return
        }
        finishBatchIfIdle()
    }

    private fun finishPermissionFailure(device: UsbDevice, message: String) {
        if (closing.get()) return
        val request = permissionRequest ?: return
        if (!request.matches(device)) return
        permissionRequest = null
        if (request.generation == generation) {
            setStatus(request.id, message)
            emit()
        }
        requestNextPermission()
    }

    private fun openCamera(id: String, controlBlock: USBMonitor.UsbControlBlock) {
        var camera: UVCCamera? = null
        var reader: ImageReader? = null
        var session: CameraSession? = null
        try {
            setStatus(id, "Opening UVC camera")
            emit()
            camera = UVCCamera(UVCParam().apply { quirks = UVCCamera.getRecommendedPlatformQuirks() })
            val result = camera.open(controlBlock)
            check(result == 0) { "UVC open failed (code $result). Check camera compatibility and hub power." }
            val modes = camera.supportedSizeList.orEmpty().mapNotNull { size ->
                val format = when (size.type) {
                    UVCCamera.UVC_VS_FRAME_MJPEG -> CaptureFormat.MJPEG
                    UVCCamera.UVC_VS_FRAME_UNCOMPRESSED -> CaptureFormat.YUYV
                    else -> return@mapNotNull null
                }
                CameraMode(size.width, size.height, format, size.fps, size.fpsList)
            }
            val mode = selectCameraMode(modes, requestedSettings)
            val frameType = if (mode.format == CaptureFormat.MJPEG) {
                UVCCamera.UVC_VS_FRAME_MJPEG
            } else {
                UVCCamera.UVC_VS_FRAME_UNCOMPRESSED
            }
            camera.setPreviewSize(Size(frameType, mode.width, mode.height, mode.fps, listOf(mode.fps)))
            reader = ImageReader.newInstance(mode.width, mode.height, PixelFormat.RGBA_8888, 3)
            reader.setOnImageAvailableListener({ source ->
                try {
                    source.acquireLatestImage()?.close()
                } catch (_: IllegalStateException) {
                    // The control thread may close the reader while a drain callback is queued.
                }
            }, surfaces)
            val activeSession = CameraSession(id, camera, controlBlock, reader, mode, requestedSettings)
            session = activeSession
            sessions[id] = activeSession
            hub.register(id, checkNotNull(info[id]).name)
            camera.setPreviewDisplay(reader.surface)
            camera.setFrameCallback({ frame -> acceptFrame(activeSession, frame) }, UVCCamera.PIXEL_FORMAT_NV21)
            camera.startPreview()
            info[id] = checkNotNull(info[id]).copy(
                detail = "${mode.width} × ${mode.height} · ${mode.format} ${mode.fps} FPS input · " +
                    "up to ${minOf(mode.fps, requestedSettings.fps)} FPS stream",
                status = "Waiting for the first camera frame",
            )
            startWatchdog(activeSession)
            emit()
        } catch (error: Exception) {
            finishOpenFailure(id, camera, reader, session, controlBlock, error)
        } catch (error: LinkageError) {
            finishOpenFailure(id, camera, reader, session, controlBlock, error)
        }
    }

    private fun finishOpenFailure(
        id: String,
        camera: UVCCamera?,
        reader: ImageReader?,
        session: CameraSession?,
        controlBlock: USBMonitor.UsbControlBlock,
        error: Throwable,
    ) {
        if (session != null) {
            closeSession(id)
        } else {
            release("failed UVC camera") { camera?.destroy(true) }
            release("failed preview surface") { reader?.close() }
            release("failed USB handle") { controlBlock.close(true) }
        }
        setStatus(id, "Could not start: ${error.description()}")
        emit()
    }

    private fun acceptFrame(session: CameraSession, frame: ByteBuffer) {
        if (!session.active.get()) return
        val now = SystemClock.elapsedRealtimeNanos()
        val deadline = session.nextFrameAt.get()
        if (now < deadline || !session.encoding.compareAndSet(false, true)) return
        val period = 1_000_000_000L / session.settings.fps
        // Keep the planned cadence so 30 FPS input can supply 20 FPS, rather than 15.
        // After a longer stall, reset instead of trying to emit a burst of overdue frames.
        session.nextFrameAt.set(if (deadline == 0L || now - deadline >= period) now + period else deadline + period)
        try {
            val expectedSize = Math.toIntExact(session.mode.width.toLong() * session.mode.height * 3L / 2L)
            val buffer = frame.duplicate().apply { rewind() }
            check(buffer.remaining() >= expectedSize) { "Camera returned an incomplete NV21 frame." }
            val pixels = ByteArray(expectedSize)
            buffer.get(pixels)
            encoders.execute {
                try {
                    if (session.active.get()) encodeAndPublish(session, pixels)
                } catch (error: Exception) {
                    reportFrameFailure(session, "JPEG encoding failed: ${error.description()}")
                } finally {
                    session.encoding.set(false)
                }
            }
        } catch (_: RejectedExecutionException) {
            // No frame queue can grow without bound; a saturated encoder drops this frame.
            session.encoding.set(false)
        } catch (error: Exception) {
            session.encoding.set(false)
            reportFrameFailure(session, "Camera frame failed: ${error.description()}")
        }
    }

    private fun encodeAndPublish(session: CameraSession, pixels: ByteArray) {
        val mode = session.mode
        val output = ByteArrayOutputStream(pixels.size / 4)
        val encoded = YuvImage(pixels, ImageFormat.NV21, mode.width, mode.height, null)
            .compressToJpeg(Rect(0, 0, mode.width, mode.height), session.settings.jpegQuality, output)
        check(encoded) { "Android could not encode this camera frame." }
        val jpeg = output.toByteArray()
        synchronized(session.publicationLock) {
            if (!session.active.get()) return
            hub.publish(session.id, jpeg)
            session.lastFrameAt.set(SystemClock.elapsedRealtime())
        }
        if (session.firstFrame.compareAndSet(false, true)) {
            control.post {
                if (sessions[session.id] === session && session.active.get()) {
                    setStatus(session.id, "Streaming", streaming = true)
                    emit()
                }
            }
        }
    }

    private fun reportFrameFailure(session: CameraSession, message: String) {
        if (!session.active.get() || !session.failureReported.compareAndSet(false, true)) return
        control.post {
            if (sessions[session.id] === session) failSession(session.id, message)
        }
    }

    private fun startWatchdog(session: CameraSession) {
        val watchdog = object : Runnable {
            override fun run() {
                if (sessions[session.id] !== session || !session.active.get()) return
                if (SystemClock.elapsedRealtime() - session.lastFrameAt.get() >= FRAME_TIMEOUT_MS) {
                    failSession(
                        session.id,
                        "No camera frames for 10 seconds. Try a lower resolution, fewer cameras, or a powered hub.",
                    )
                } else {
                    control.postDelayed(this, FRAME_TIMEOUT_MS / 2)
                }
            }
        }
        session.watchdog = watchdog
        control.postDelayed(watchdog, FRAME_TIMEOUT_MS)
    }

    private fun failSession(id: String, message: String) {
        closeSession(id)
        setStatus(id, message)
        emit()
        finishBatchIfIdle()
    }

    private fun closeSession(id: String) {
        val session = sessions.remove(id) ?: return
        synchronized(session.publicationLock) {
            session.active.set(false)
            hub.remove(id)
        }
        session.watchdog?.let(control::removeCallbacks)
        // Keep the ImageReader draining until native capture has fully stopped.
        release("frame callback") { session.camera.setFrameCallback(null, UVCCamera.PIXEL_FORMAT_NV21) }
        release("UVC camera") { session.camera.destroy(true) }
        release("preview surface") { session.reader.close() }
        release("USB handle") { session.controlBlock.close(true) }
    }

    private fun stopCapture() {
        batchCompletion.cancel()
        val interruptedIds = sessions.keys.toSet() + openQueue.toSet() +
            listOfNotNull(permissionRequest?.takeIf { it.generation == generation }?.id)
        generation += 1
        openQueue.clear()
        sessions.keys.toList().forEach(::closeSession)
        interruptedIds.forEach { setStatus(it, "Ready") }
        // Android cannot dismiss an outstanding permission dialog. Keep its generation
        // until its response arrives so it cannot start a camera after Stop or a new Start.
    }

    private fun finishBatchIfIdle() {
        if (closing.get()) return
        val finished = batchCompletion.takeIfFinished(
            hasSessions = sessions.isNotEmpty(),
            hasCurrentPermission = permissionRequest?.generation == generation,
            hasQueuedCameras = openQueue.isNotEmpty(),
            isOpening = openingCamera,
        ) ?: return
        try {
            finished()
        } catch (error: Exception) {
            Log.w("SightlineUSB", "Capture completion callback failed", error)
        }
    }

    private fun setStatus(id: String, status: String, streaming: Boolean = false) {
        info[id]?.let { info[id] = it.copy(status = status, streaming = streaming) }
    }

    private fun emit() {
        if (!closing.get()) onChanged(info.values.toList())
    }

    private fun cameraInfo(device: UsbDevice): CameraSource {
        val product = runCatching { device.productName }.getOrNull()?.takeIf { it.isNotBlank() } ?: "USB camera"
        val hardware = String.format(Locale.US, "%04X:%04X", device.vendorId, device.productId)
        return CameraSource(
            deviceId(device), "$product · $hardware · USB ${device.deviceId}",
            "UVC camera · select to create an individual stream",
        )
    }

    private fun PermissionRequest.matches(device: UsbDevice): Boolean =
        id == deviceId(device) && this.device.deviceName == device.deviceName

    private fun Throwable.description(): String = message?.takeIf { it.isNotBlank() }?.take(200)
        ?: javaClass.simpleName

    private fun release(resource: String, action: () -> Unit) {
        try {
            action()
        } catch (error: Exception) {
            Log.w("SightlineUSB", "Could not release $resource", error)
        } catch (error: LinkageError) {
            Log.w("SightlineUSB", "Native library unavailable while releasing $resource", error)
        }
    }

    private fun isVideoDevice(device: UsbDevice): Boolean =
        (0 until device.interfaceCount).any { device.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_VIDEO }

    private fun deviceId(device: UsbDevice): String = "usb-${device.deviceId}"

    private companion object {
        const val FRAME_TIMEOUT_MS = 10_000L
    }
}
