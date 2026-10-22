package com.sightline.mobile

import android.Manifest
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sightline.mobile.camera.CaptureSettings
import com.sightline.mobile.ui.CameraScreen

class MainActivity : ComponentActivity() {
    private var capture by mutableStateOf<CaptureService?>(null)
    private var permissionError by mutableStateOf<String?>(null)
    private var pendingStart: Pair<List<String>, CaptureSettings>? = null
    private var bound = false
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) { capture = (binder as CaptureService.LocalBinder).service }
        override fun onServiceDisconnected(name: ComponentName) { capture = null }
    }
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val request = pendingStart
        pendingStart = null
        if (request == null) {
            permissionError = if (granted(Manifest.permission.CAMERA)) null else "Allow camera access in Settings → Apps → Sightline → Permissions, then tap Refresh."
            capture?.scan()
            return@registerForActivityResult
        }
        if (requiredPermissions().all { granted(it) }) startCapture(request.first, request.second)
        else permissionError = "Allow camera and local network access to stream. Tap Start again, or enable them in Settings → Apps → Sightline → Permissions."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        savedInstanceState?.getStringArrayList("pendingCameraIds")?.let { ids ->
            pendingStart = ids to CaptureSettings(savedInstanceState.getInt("pendingWidth", 640), savedInstanceState.getInt("pendingHeight", 480))
        }
        enableEdgeToEdge()
        bound = bindService(Intent(this, CaptureService::class.java), connection, BIND_AUTO_CREATE)
        setContent {
            val service = capture
            val state = if (service != null) service.state.collectAsStateWithLifecycle().value else CaptureUiState()
            CameraScreen(state, service != null, permissionError,
                onScan = {
                    if (granted(Manifest.permission.CAMERA)) service?.scan()
                    else permissions.launch(arrayOf(Manifest.permission.CAMERA))
                },
                onStart = { ids, settings ->
                    permissionError = null
                    val required = requiredPermissions()
                    if (required.all { granted(it) }) startCapture(ids, settings)
                    else {
                        pendingStart = ids to settings
                        val requested = required + if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()
                        permissions.launch(requested.filterNot { granted(it) }.toTypedArray())
                    }
                },
                onStop = { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.STOP)) },
                onCopy = { text -> (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Camera URL", text)) },
                onShare = { text -> startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share camera link")) },
            )
        }
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    private fun requiredPermissions() = listOf(Manifest.permission.CAMERA) +
        if (Build.VERSION.SDK_INT >= 37) listOf("android.permission.ACCESS_LOCAL_NETWORK") else emptyList()

    private fun startCapture(ids: List<String>, settings: CaptureSettings) {
        try {
            ContextCompat.startForegroundService(this, Intent(this, CaptureService::class.java)
                .setAction(CaptureService.START).putStringArrayListExtra("ids", ArrayList(ids))
                .putExtra("width", settings.width).putExtra("height", settings.height))
        } catch (e: RuntimeException) { permissionError = "Could not start: ${e.message}" }
    }

    override fun onDestroy() {
        if (bound) unbindService(connection)
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        pendingStart?.let { (ids, settings) ->
            outState.putStringArrayList("pendingCameraIds", ArrayList(ids))
            outState.putInt("pendingWidth", settings.width)
            outState.putInt("pendingHeight", settings.height)
        }
        super.onSaveInstanceState(outState)
    }
}
