package com.sightline.mobile.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.camera2.*
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.view.OrientationEventListener
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.sightline.mobile.stream.FrameHub
import java.io.ByteArrayOutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Camera2 ownership stays on one handler; JPEG work is bounded and runs off that handler. */
internal class PhoneCameraEngine(
    context: Context,
    private val hub: FrameHub,
    private val onChanged: (List<CameraSource>, String?) -> Unit,
) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(CameraManager::class.java)
    private val catalog = PhoneCameraCatalog(manager)
    private val thread = HandlerThread("Sightline-Phone-Cameras").apply { start() }
    private val control = Handler(thread.looper)
    private val callbackExecutor = Executor { control.post(it) }
    private val encoders = ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(5),
        { task -> Thread(task, "Sightline-Phone-JPEG") }, ThreadPoolExecutor.AbortPolicy())
    private val closing = AtomicBoolean(false)
    @Volatile private var available = emptyList<PhoneCamera>()
    private val info = linkedMapOf<String, CameraSource>()
    private val groups = linkedMapOf<String, CameraGroup>()
    private val opening = mutableSetOf<CameraGroup>()
    private val retiring = mutableSetOf<CameraDevice>()
    private var pendingStart: (() -> Unit)? = null
    private val completion = CaptureBatchCompletion()
    private var notice: String? = null
    @Volatile private var deviceOrientation = 0
    private val orientation = object : OrientationEventListener(appContext) {
        override fun onOrientationChanged(angle: Int) {
            if (angle == ORIENTATION_UNKNOWN) return
            val difference = kotlin.math.abs(angle - deviceOrientation).let { minOf(it, 360 - it) }
            if (difference >= 60) deviceOrientation = ((angle + 45) / 90 * 90) % 360
        }
    }

    private class CameraOutput(val camera: PhoneCamera, val reader: ImageReader, val settings: CaptureSettings) {
        val active = AtomicBoolean(true)
        val encoding = AtomicBoolean(false)
        val lastFrameAt = AtomicLong(SystemClock.elapsedRealtime())
        val firstFrame = AtomicBoolean(false)
        val publicationLock = Any()
        var nextFrameAt = 0L
    }

    private class CameraGroup(val deviceId: String, val outputs: List<CameraOutput>) {
        var active = true
        var device: CameraDevice? = null
        var session: CameraCaptureSession? = null
        var configuring = false
        var watchdog: Runnable? = null
    }

    fun scan() { if (!closing.get()) control.post { if (!closing.get()) refreshCatalog() } }

    fun selectionError(ids: List<String>): String? {
        val selected = ids.map { id -> available.firstOrNull { it.source.id == id }
            ?: return "A selected phone camera is no longer available. Refresh and select it again." }
        return try { catalog.selectionError(selected) }
        catch (error: Exception) { "Could not check phone cameras: ${error.message ?: "camera service unavailable"}. Try Refresh." }
    }

    fun start(ids: List<String>, settings: CaptureSettings, onFinished: () -> Unit) {
        require(ids.isNotEmpty() && ids.size <= 5)
        settings.validate()
        check(!closing.get())
        control.post {
            if (closing.get()) return@post
            stopCapture()
            refreshCatalog()
            completion.begin(onFinished)
            ids.forEach { id -> setStatus(id, "Waiting for camera access") }
            pendingStart = {
                val error = selectionError(ids)
                if (error != null) {
                    ids.forEach { setStatus(it, error) }
                    emit()
                    finishIfIdle()
                } else openBatch(ids.map { id -> available.first { it.source.id == id } }, settings)
            }
            emit()
            continueAfterClose()
        }
    }

    fun stop() { if (!closing.get()) control.post { stopCapture(); emit() } }

    fun close() {
        if (!closing.compareAndSet(false, true)) return
        control.post { stopCapture(); encoders.shutdownNow(); continueAfterClose() }
    }

    private fun refreshCatalog() {
        try {
            val cameras = catalog.read()
            available = cameras
            val old = info.toMap()
            info.clear()
            cameras.forEach { camera -> info[camera.source.id] = old[camera.source.id] ?: camera.source }
            notice = if (cameras.isEmpty()) "Android isn't exposing a usable phone camera. Check camera privacy settings, or connect a USB webcam." else null
        } catch (error: Exception) {
            notice = "Could not list phone cameras. Check camera privacy settings and tap Refresh. ${error.message.orEmpty().take(100)}"
        }
        emit()
    }

    private fun openBatch(selected: List<PhoneCamera>, settings: CaptureSettings) {
        if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            selected.forEach { setStatus(it.source.id, "Camera permission is required. Tap Start and allow camera access.") }
            emit(); finishIfIdle(); return
        }
        try {
            selected.groupBy { it.deviceId }.forEach { (deviceId, cameras) ->
                val sizes = cameras.map { it.sizes.toSet() }.reduce { common, sizes -> common.intersect(sizes) }
                val size = sizes.filter { it.width <= settings.width && it.height <= settings.height && it.width % 2 == 0 && it.height % 2 == 0 }
                    .maxByOrNull { it.width.toLong() * it.height }
                    ?: error("No shared camera size at or below ${settings.width} × ${settings.height}. Try a higher quality or one lens.")
                val outputs = mutableListOf<CameraOutput>()
                try {
                    cameras.forEach { camera ->
                        val reader = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 3)
                        outputs += CameraOutput(camera, reader, settings)
                    }
                } catch (error: Exception) { outputs.forEach { it.reader.close() }; throw error }
                groups[deviceId] = CameraGroup(deviceId, outputs)
            }
            // Validate the actual output sizes, not just the advertised camera ID pair.
            if (Build.VERSION.SDK_INT >= 30 && groups.size > 1) {
                val configs = groups.mapValues { (_, group) -> sessionConfiguration(group) }
                check(manager.isConcurrentSessionConfigurationSupported(configs)) {
                    "This camera combination cannot stream at this quality. Try 640 × 480 or select one phone camera."
                }
            }
            if (orientation.canDetectOrientation()) orientation.enable()
            groups.values.forEach { group ->
                group.outputs.forEach { output ->
                    hub.register(output.camera.source.id, output.camera.source.name)
                    output.reader.setOnImageAvailableListener({ acceptFrame(group, output) }, control)
                    info[output.camera.source.id] = output.camera.source.copy(
                        detail = "Phone camera · ${output.reader.width} × ${output.reader.height} · up to ${settings.fps} FPS",
                        status = "Opening phone camera",
                    )
                }
                startWatchdog(group)
            }
            emit()
            // Camera2 requires every device to be open before any concurrent session is configured.
            groups.values.toList().forEach { group ->
                opening += group
                try { manager.openCamera(group.deviceId, deviceCallback(group), control) }
                catch (error: Exception) {
                    opening.remove(group)
                    failGroup(group, "Could not open phone camera: ${error.message}. Close other camera apps and try again.")
                }
            }
            configureOpenedGroups()
        } catch (error: Exception) {
            val message = error.message ?: "Phone camera configuration failed. Try one camera."
            groups.values.toList().forEach { releaseGroup(it) }
            selected.forEach { setStatus(it.source.id, message) }
            emit(); finishIfIdle()
        }
    }

    private fun deviceCallback(group: CameraGroup) = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            opening.remove(group)
            if (!isCurrent(group)) { retire(camera); continueAfterClose(); return }
            group.device = camera
            configureOpenedGroups()
        }
        override fun onDisconnected(camera: CameraDevice) = failed(camera, "Phone camera disconnected or was taken by another app.")
        override fun onError(camera: CameraDevice, error: Int) = failed(camera, when (error) {
            ERROR_CAMERA_IN_USE -> "Camera is in use. Close other camera apps and try again."
            ERROR_MAX_CAMERAS_IN_USE -> "The phone cannot open more cameras. Select fewer phone cameras."
            ERROR_CAMERA_DISABLED -> "Camera access is disabled. Check the phone's camera privacy switch and administrator settings."
            else -> "Android camera error $error. Stop streaming, then try again."
        })
        private fun failed(camera: CameraDevice, message: String) {
            opening.remove(group)
            if (isCurrent(group)) { group.device = camera; failGroup(group, message) } else retire(camera)
            configureOpenedGroups()
            continueAfterClose()
        }
        override fun onClosed(camera: CameraDevice) { retiring.remove(camera); continueAfterClose() }
    }

    private fun configureOpenedGroups() {
        if (opening.any { it.active } || closing.get()) return
        groups.values.toList().filter { it.device != null && !it.configuring }.forEach { group ->
            group.configuring = true
            try {
                if (Build.VERSION.SDK_INT >= 28) group.device!!.createCaptureSession(sessionConfiguration(group))
                else {
                    @Suppress("DEPRECATION")
                    group.device!!.createCaptureSession(group.outputs.map { it.reader.surface }, sessionCallback(group), control)
                }
            } catch (error: Exception) { failGroup(group, "Could not configure camera: ${error.message}. Try one lens at 640 × 480.") }
        }
    }

    @RequiresApi(28)
    private fun sessionConfiguration(group: CameraGroup) = SessionConfiguration(
        SessionConfiguration.SESSION_REGULAR,
        group.outputs.map { output -> OutputConfiguration(output.reader.surface).apply { setPhysicalCameraId(output.camera.physicalId) } },
        callbackExecutor, sessionCallback(group),
    )

    private fun sessionCallback(group: CameraGroup) = object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(session: CameraCaptureSession) {
            if (!isCurrent(group)) { session.close(); return }
            group.session = session
            try {
                val device = checkNotNull(group.device)
                val characteristics = manager.getCameraCharacteristics(group.deviceId)
                val request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                    group.outputs.forEach { addTarget(it.reader.surface) }
                    set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                    val focus = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
                    if (CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO in focus) set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                    chooseFps(characteristics, group.outputs.first().settings.fps)?.let { set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
                }.build()
                session.setRepeatingRequest(request, null, control)
                group.outputs.forEach { setStatus(it.camera.source.id, "Waiting for the first camera frame") }
                emit()
            } catch (error: Exception) { failGroup(group, "Could not start phone capture: ${error.message}") }
        }
        override fun onConfigureFailed(session: CameraCaptureSession) {
            session.close()
            if (isCurrent(group)) failGroup(group, "This phone rejected the camera setup. Try one phone camera at 640 × 480.")
        }
    }

    private fun acceptFrame(group: CameraGroup, output: CameraOutput) {
        if (!isCurrent(group)) return
        try {
            val image = output.reader.acquireLatestImage() ?: return
            image.use {
                val now = SystemClock.elapsedRealtimeNanos()
                if (now < output.nextFrameAt || !output.encoding.compareAndSet(false, true)) return
                val period = 1_000_000_000L / output.settings.fps
                val deadline = output.nextFrameAt
                output.nextFrameAt = if (deadline == 0L || now - deadline >= period) now + period else deadline + period
                try {
                    val frame = copyPhoneFrame(image)
                    val sensor = output.camera.characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
                    val front = output.camera.characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
                    // Camera2 JPEG_ORIENTATION formula for OrientationEventListener's clockwise angle.
                    val relativeOrientation = if (front) -deviceOrientation else deviceOrientation
                    val rotation = (sensor + relativeOrientation + 360) % 360
                    encoders.execute {
                        try {
                            if (output.active.get()) encodeAndPublish(group, output, frame.rotated(rotation))
                        } catch (error: Exception) {
                            control.post { if (isCurrent(group)) failGroup(group, "Phone frame encoding failed: ${error.message}") }
                        } finally { output.encoding.set(false) }
                    }
                } catch (_: RejectedExecutionException) { output.encoding.set(false) }
                catch (error: Exception) { output.encoding.set(false); throw error }
            }
        } catch (error: Exception) { if (isCurrent(group)) failGroup(group, "Phone frame capture failed: ${error.message}") }
    }

    private fun encodeAndPublish(group: CameraGroup, output: CameraOutput, frame: Nv21Frame) {
        val bytes = ByteArrayOutputStream(frame.pixels.size / 4)
        check(YuvImage(frame.pixels, ImageFormat.NV21, frame.width, frame.height, null)
            .compressToJpeg(Rect(0, 0, frame.width, frame.height), output.settings.jpegQuality, bytes)) { "JPEG compression failed" }
        synchronized(output.publicationLock) {
            if (!output.active.get()) return
            hub.publish(output.camera.source.id, bytes.toByteArray())
            output.lastFrameAt.set(SystemClock.elapsedRealtime())
        }
        if (output.firstFrame.compareAndSet(false, true)) control.post {
            if (isCurrent(group) && output.active.get()) { setStatus(output.camera.source.id, "Streaming", true); emit() }
        }
    }

    private fun startWatchdog(group: CameraGroup) {
        val watchdog = object : Runnable {
            override fun run() {
                if (!isCurrent(group)) return
                if (group.outputs.any { SystemClock.elapsedRealtime() - it.lastFrameAt.get() >= 15_000 }) {
                    failGroup(group, "No phone camera frames for 15 seconds. Check camera privacy settings or select fewer cameras.")
                    configureOpenedGroups()
                } else control.postDelayed(this, 5_000)
            }
        }
        group.watchdog = watchdog
        control.postDelayed(watchdog, 15_000)
    }

    private fun failGroup(group: CameraGroup, message: String) {
        if (!isCurrent(group)) return
        releaseGroup(group)
        group.outputs.forEach { setStatus(it.camera.source.id, message) }
        emit(); finishIfIdle()
    }

    private fun releaseGroup(group: CameraGroup) {
        group.active = false
        groups.remove(group.deviceId)
        group.watchdog?.let(control::removeCallbacks)
        group.outputs.forEach { output -> synchronized(output.publicationLock) { output.active.set(false); hub.remove(output.camera.source.id) } }
        release { group.session?.close() }
        group.device?.let(::retire)
        group.outputs.forEach { release { it.reader.close() } }
    }

    private fun retire(device: CameraDevice) { if (retiring.add(device)) device.close() }

    private fun stopCapture() {
        pendingStart = null
        completion.cancel()
        orientation.disable()
        val interrupted = groups.values.flatMap { group -> group.outputs.map { it.camera.source.id } }
        groups.values.toList().forEach(::releaseGroup)
        interrupted.forEach { setStatus(it, "Ready") }
    }

    private fun continueAfterClose() {
        if (opening.isNotEmpty() || retiring.isNotEmpty()) return
        if (closing.get()) { thread.quitSafely(); return }
        pendingStart?.also { pendingStart = null }?.invoke()
    }

    private fun finishIfIdle() {
        if (groups.isNotEmpty() || pendingStart != null) return
        orientation.disable()
        completion.takeIfFinished(false, false, false, false)?.invoke()
    }

    private fun isCurrent(group: CameraGroup) = !closing.get() && group.active && groups[group.deviceId] === group
    private fun setStatus(id: String, status: String, streaming: Boolean = false) { info[id]?.let { info[id] = it.copy(status = status, streaming = streaming) } }
    private fun emit() { if (!closing.get()) onChanged(info.values.toList(), notice) }
    private fun release(action: () -> Unit) { try { action() } catch (error: Exception) { Log.w("SightlinePhone", "Camera cleanup failed", error) } }

    private fun chooseFps(characteristics: CameraCharacteristics, target: Int): Range<Int>? {
        val ranges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES).orEmpty()
        return ranges.filter { it.upper >= target }.minWithOrNull(compareBy<Range<Int>> { it.upper }.thenByDescending { it.lower })
            ?: ranges.maxByOrNull { it.upper }
    }
}
