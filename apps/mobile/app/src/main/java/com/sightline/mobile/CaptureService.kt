package com.sightline.mobile

import android.annotation.SuppressLint
import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.sightline.mobile.camera.*
import com.sightline.mobile.stream.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

data class CaptureUiState(
    val cameras: List<UsbCameraInfo> = emptyList(),
    val running: Boolean = false,
    val addresses: List<String> = emptyList(),
    val channels: List<ChannelInfo> = emptyList(),
    val error: String? = null,
    val scanComplete: Boolean = false,
)

/** Owns capture independently of activity rotation or screen locking. */
class CaptureService : Service() {
    inner class LocalBinder : Binder() { val service: CaptureService get() = this@CaptureService }
    private val binder = LocalBinder()
    private val mutableState = MutableStateFlow(CaptureUiState())
    val state = mutableState.asStateFlow()
    private val hub = FrameHub()
    private lateinit var cameras: UsbCameraEngine
    private val control = Executors.newSingleThreadExecutor()
    private val commandEpoch = AtomicLong()
    private var server: MjpegServer? = null
    private var cpuLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var destroyed = false
    private val refresh = object : Runnable {
        override fun run() {
            if (destroyed) return
            mutableState.update { it.copy(addresses = lanAddresses(), channels = hub.channels()) }
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "USB camera streaming", NotificationManager.IMPORTANCE_LOW)
        )
        cameras = UsbCameraEngine(this, hub) { devices -> mutableState.update { it.copy(cameras = devices, scanComplete = true) } }
        cameras.scan()
        handler.post(refresh)
    }

    override fun onBind(intent: Intent): IBinder = binder
    fun scan() = cameras.scan()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            START -> {
                val epoch = commandEpoch.incrementAndGet()
                val ids = intent.getStringArrayListExtra("ids").orEmpty().distinct()
                if (ids.isEmpty() || ids.size > 5) {
                    mutableState.update { it.copy(error = "Select between one and five cameras.") }
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                try {
                    val types = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
                    ServiceCompat.startForeground(this, 1, notification(), types)
                } catch (e: RuntimeException) {
                    mutableState.update { it.copy(error = "Cannot start streaming: ${e.message}. Open the app and grant camera access.") }
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                val settings = CaptureSettings(width = intent.getIntExtra("width", 640), height = intent.getIntExtra("height", 480))
                mutableState.update { it.copy(running = true, error = null) }
                control.execute {
                    if (commandEpoch.get() != epoch) return@execute
                    try {
                        stopResources()
                        server = MjpegServer(hub).also { it.start() }
                        acquireLocks()
                        cameras.start(ids, settings) {
                            handler.post {
                                if (!destroyed && commandEpoch.get() == epoch) {
                                    stopBatch(epoch, startId, "All selected cameras stopped. Check their status, then try again.")
                                }
                            }
                        }
                    } catch (e: Exception) {
                        stopResources()
                        handler.post {
                            if (commandEpoch.get() == epoch) {
                                mutableState.update { it.copy(running = false, error = "Streaming could not start: ${e.message}") }
                                stopForeground(STOP_FOREGROUND_REMOVE)
                                stopSelf(startId)
                            }
                        }
                    }
                }
            }
            STOP -> {
                stopBatch(commandEpoch.incrementAndGet(), startId)
            }
        }
        // Never restart capture silently after Android kills the process.
        return START_NOT_STICKY
    }

    private fun stopBatch(epoch: Long, startId: Int, error: String? = null) {
        control.execute {
            if (commandEpoch.get() != epoch) return@execute
            stopResources()
            handler.post {
                if (commandEpoch.get() == epoch) {
                    mutableState.update { it.copy(running = false, channels = emptyList(), error = error) }
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
            }
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_camera).setContentTitle("Sightline USB is streaming")
            .setContentText("Camera feeds are available on your local network")
            .setContentIntent(open).setOngoing(true).addAction(0, "Stop streams", stop).build()
    }

    @Suppress("DEPRECATION")
    @SuppressLint("WakelockTimeout") // User-controlled live session; released on Stop, failure, or service destruction.
    private fun acquireLocks() {
        cpuLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sightline:stream").apply { acquire() }
        wifiLock = (applicationContext.getSystemService(WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "sightline:stream").apply { acquire() }
    }

    private fun stopResources() {
        cameras.stop()
        server?.stop()
        server = null
        cpuLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        cpuLock = null
        wifiLock = null
    }

    override fun onDestroy() {
        destroyed = true
        commandEpoch.incrementAndGet()
        handler.removeCallbacks(refresh)
        control.execute { stopResources(); cameras.close() }
        control.shutdown()
        super.onDestroy()
    }

    companion object {
        const val START = "com.sightline.mobile.START"
        const val STOP = "com.sightline.mobile.STOP"
        private const val CHANNEL = "usb-streams"

        private fun lanAddresses(): List<String> = try {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                .filter { it.isUp && !it.isLoopback && !it.isPointToPoint }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .filter { !it.isLoopbackAddress && it.isSiteLocalAddress }
                .mapNotNull { it.hostAddress?.let { address -> "http://$address:8080" } }.distinct()
        } catch (_: Exception) { emptyList() }
    }
}
