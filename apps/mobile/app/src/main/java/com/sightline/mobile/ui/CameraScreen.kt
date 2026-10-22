package com.sightline.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sightline.mobile.CaptureUiState
import com.sightline.mobile.camera.CaptureSettings

private val Palette = lightColorScheme(
    primary = Color(0xFF176A74), onPrimary = Color.White,
    primaryContainer = Color(0xFFD7EEF0), onPrimaryContainer = Color(0xFF173E45),
    background = Color(0xFFF2F6F7), surface = Color.White,
    onSurface = Color(0xFF20343C), onBackground = Color(0xFF20343C),
    surfaceVariant = Color(0xFFE2EDEF), onSurfaceVariant = Color(0xFF435C64),
)

@Composable
fun CameraScreen(
    state: CaptureUiState, ready: Boolean, permissionError: String?,
    onScan: () -> Unit, onStart: (List<String>, CaptureSettings) -> Unit,
    onStop: () -> Unit, onCopy: (String) -> Unit, onShare: (String) -> Unit,
) {
    var selected by rememberSaveable { mutableStateOf(listOf<String>()) }
    var selecting by remember { mutableStateOf(false) }
    var profileMenu by remember { mutableStateOf(false) }
    var hd by rememberSaveable { mutableStateOf(false) }
    val standardProfile = CaptureSettings()
    val highProfile = CaptureSettings(1280, 720)
    val profile = if (hd) highProfile else standardProfile
    val attachedIds = state.cameras.map { it.id }
    LaunchedEffect(attachedIds, ready, state.scanComplete) {
        if (ready && state.scanComplete) selected = selected.filter { it in attachedIds }
    }

    MaterialTheme(colorScheme = Palette) {
        Scaffold(containerColor = Palette.background, bottomBar = {
            Surface(shadowElevation = 4.dp) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp)) {
                    Button(
                        onClick = { if (state.running) onStop() else onStart(selected, profile) },
                        enabled = ready && (state.running || selected.isNotEmpty()),
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = if (state.running) Palette.error else Palette.primary),
                    ) { Text(when {
                        state.running -> "Stop all streams"
                        selected.isEmpty() -> "Select a camera to start"
                        selected.size == 1 -> "Start camera stream"
                        else -> "Start ${selected.size} camera streams"
                    }) }
                }
            }
        }) { padding ->
            LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                item {
                    Text("Sightline USB", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text("Your cameras. One phone. Live in your browser.", color = Palette.onSurfaceVariant)
                }
                item {
                    Surface(shape = RoundedCornerShape(18.dp), color = Palette.primaryContainer) {
                        Column(Modifier.padding(18.dp)) {
                            Text(if (state.running) "${state.cameras.count { it.streaming }} cameras sending frames" else "Ready when you are", style = MaterialTheme.typography.titleLarge)
                            Spacer(Modifier.height(6.dp))
                            Text(if (state.running) "Keep the USB hub connected. Streaming continues when you leave this screen."
                                else "Connect a powered USB hub to your phone, then plug in your USB webcams.")
                        }
                    }
                }
                if (permissionError != null || state.error != null) item {
                    Surface(color = Palette.errorContainer, shape = RoundedCornerShape(12.dp)) {
                        Text(permissionError ?: state.error.orEmpty(), Modifier.padding(16.dp), color = Palette.onErrorContainer)
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Choose cameras", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
                        TextButton(onClick = onScan, enabled = ready) { Text("Refresh") }
                    }
                    Box {
                        OutlinedButton(onClick = { selecting = true }, enabled = ready && !state.running && state.cameras.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                            Text(if (state.cameras.isEmpty()) "No USB cameras detected" else "${selected.size} selected of ${state.cameras.size} connected  ▾")
                        }
                        DropdownMenu(expanded = selecting, onDismissRequest = { selecting = false }) {
                            state.cameras.forEach { camera ->
                                DropdownMenuItem(
                                    text = { Column { Text(camera.name); Text(camera.detail, style = MaterialTheme.typography.bodySmall) } },
                                    trailingIcon = { Checkbox(checked = camera.id in selected, onCheckedChange = null) },
                                    enabled = camera.id in selected || selected.size < 5,
                                    onClick = { selected = if (camera.id in selected) selected - camera.id else selected + camera.id },
                                )
                            }
                            DropdownMenuItem(text = { Text("Done") }, onClick = { selecting = false })
                        }
                    }
                    Text("Select up to five. Begin with one, then try two together.", style = MaterialTheme.typography.bodySmall, color = Palette.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Box {
                        OutlinedButton(onClick = { profileMenu = true }, enabled = !state.running, modifier = Modifier.fillMaxWidth()) {
                            Text("${profile.label()}${if (hd) "" else " (recommended)"}  ▾")
                        }
                        DropdownMenu(expanded = profileMenu, onDismissRequest = { profileMenu = false }) {
                            DropdownMenuItem(text = { Text(standardProfile.label()) }, onClick = { hd = false; profileMenu = false })
                            DropdownMenuItem(text = { Text(highProfile.label()) }, onClick = { hd = true; profileMenu = false })
                        }
                    }
                }
                items(state.cameras, key = { it.id }) { camera ->
                    val channel = state.channels.firstOrNull { it.id == camera.id }
                    Surface(shape = RoundedCornerShape(14.dp)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(camera.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(camera.detail, style = MaterialTheme.typography.bodySmall, color = Palette.onSurfaceVariant)
                            Text(camera.status, color = if (camera.streaming) Palette.primary else Palette.onSurfaceVariant)
                            if (channel != null) {
                                Text("${channel.frameCount} frames delivered to the server", style = MaterialTheme.typography.bodySmall)
                                state.addresses.firstOrNull()?.let { base ->
                                    val url = "$base/camera/${camera.id}/stream"
                                    SelectionContainer { Text(url, style = MaterialTheme.typography.bodySmall) }
                                    Row { TextButton(onClick = { onCopy(url) }) { Text("Copy stream link") }; TextButton(onClick = { onShare(url) }) { Text("Share") } }
                                }
                            }
                        }
                    }
                }
                item {
                    Text("Watch on your computer", style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(8.dp))
                    if (state.running && state.addresses.isNotEmpty()) {
                        state.addresses.forEach { base ->
                            Surface(shape = RoundedCornerShape(12.dp)) {
                                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                                    SelectionContainer { Text(base, fontWeight = FontWeight.SemiBold) }
                                    Text("Open this address in a browser on the same Wi-Fi.", style = MaterialTheme.typography.bodySmall)
                                    Row { TextButton(onClick = { onCopy(base) }) { Text("Copy address") }; TextButton(onClick = { onShare(base) }) { Text("Share") } }
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                        }
                    } else {
                        Text(if (state.running) "Join the same Wi-Fi as your computer, or turn on your phone's hotspot and connect your computer to it. Your browser address will appear here."
                            else "Start streaming to see your browser address. Put your phone and computer on the same Wi-Fi, or connect your computer to the phone's hotspot.", color = Palette.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(12.dp))
                    Text("Use a trusted network: anyone on that network who knows the address can view these feeds. No video is recorded or uploaded to a cloud service.", style = MaterialTheme.typography.bodySmall, color = Palette.onSurfaceVariant)
                }
                if (state.cameras.isEmpty()) item {
                    Text("Camera not appearing?", style = MaterialTheme.typography.titleMedium)
                    Text("Check that the phone supports USB OTG, the hub has power, and the camera is a UVC webcam. Some phones have an OTG switch in Settings. Then tap Refresh.", color = Palette.onSurfaceVariant)
                }
            }
        }
    }
}

private fun CaptureSettings.label() = "$width × $height · up to $fps fps"
