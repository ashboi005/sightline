package com.sightline.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sightline.mobile.CaptureUiState
import com.sightline.mobile.camera.CaptureSettings
import com.sightline.mobile.camera.CameraSource
import com.sightline.mobile.camera.CameraKind
import com.sightline.mobile.stream.ChannelInfo
import kotlinx.coroutines.launch

@Composable
fun CameraScreen(
    state: CaptureUiState, ready: Boolean, permissionError: String?,
    onScan: () -> Unit, onStart: (List<String>, CaptureSettings) -> Unit,
    onStop: () -> Unit, onCopy: (String) -> Unit, onShare: (String) -> Unit,
    darkTheme: Boolean = false, onThemeChange: (Boolean) -> Unit = {},
) {
    var selected by rememberSaveable { mutableStateOf(state.channels.map { it.id }) }
    var selecting by rememberSaveable { mutableStateOf(false) }
    var help by rememberSaveable { mutableStateOf(false) }
    var hd by rememberSaveable { mutableStateOf(false) }
    val profile = if (hd) CaptureSettings(1280, 720) else CaptureSettings()
    val attachedIds = state.cameras.map { it.id }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val copy: (String) -> Unit = { url ->
        onCopy(url)
        snackbar.currentSnackbarData?.dismiss()
        scope.launch { snackbar.showSnackbar("Link copied") }
    }
    LaunchedEffect(attachedIds, ready, state.scanComplete) {
        if (ready && state.scanComplete) selected = selected.filter { it in attachedIds }
    }
    LaunchedEffect(state.running) { if (state.running) selecting = false }

    SightlineTheme(darkTheme) {
        Scaffold(
            containerColor = SightlineTheme.colors.chalk,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                StreamActionBar(state, ready, selected.size, onStop) {
                    if (selected.isEmpty()) selecting = true else onStart(selected, profile)
                }
            },
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets), contentAlignment = Alignment.TopCenter) {
                LazyColumn(
                    Modifier.widthIn(max = 680.dp).fillMaxSize(),
                    contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    item { StudioHeader(darkTheme, onThemeChange) { help = true } }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Camera studio", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.semantics { heading() })
                            val liveCount = state.cameras.count { it.streaming }
                            Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                                when {
                                    !ready || !state.scanComplete -> StatusPill("Looking for cameras", working = true)
                                    state.running && liveCount > 0 -> StatusPill("$liveCount ${if (liveCount == 1) "camera" else "cameras"} live", live = true)
                                    state.running -> StatusPill("Connecting cameras", working = true)
                                    state.cameras.isEmpty() -> StatusPill("Waiting for a camera", working = true)
                                    else -> StatusPill("${state.cameras.size} cameras available")
                                }
                            }
                        }
                    }
                    if (state.cameraNotice != null) item {
                        Text(state.cameraNotice, style = MaterialTheme.typography.bodySmall, color = SightlineTheme.colors.mutedInk)
                    }
                    val error = permissionError ?: state.error
                    if (error != null) item {
                        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(20.dp)) {
                            Column(Modifier.padding(20.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    StudioGlyph(StudioIcon.Info, color = MaterialTheme.colorScheme.error)
                                    Text("Streaming needs attention", style = MaterialTheme.typography.titleSmall)
                                }
                                Text(error, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                    if (state.running) item { BrowserPanel(state, copy, onShare) }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                                SectionHeading("Cameras", Modifier.weight(1f))
                                TextButton(onClick = onScan, enabled = ready, colors = quietButtonColors()) {
                                    StudioGlyph(StudioIcon.Refresh, Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Refresh")
                                }
                            }
                            when {
                                !ready || !state.scanComplete -> ClayPanel(tone = ClayTone.Lilac) {
                                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = SightlineTheme.colors.lilacInk, trackColor = SightlineTheme.colors.lilac)
                                    Text("Getting your cameras ready…", style = MaterialTheme.typography.titleMedium)
                                }
                                state.cameras.isEmpty() -> EmptyCameras()
                                !state.running -> {
                                    OutlinedButton(
                                        onClick = { selecting = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                                        shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, SightlineTheme.colors.border),
                                        colors = ButtonDefaults.outlinedButtonColors(containerColor = SightlineTheme.colors.card, contentColor = SightlineTheme.colors.ink),
                                        contentPadding = PaddingValues(16.dp),
                                    ) {
                                        StudioGlyph(StudioIcon.Camera, color = SightlineTheme.colors.marigoldInk)
                                        Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text("Choose cameras", style = MaterialTheme.typography.labelLarge)
                                            Text("${selected.size} of ${state.cameras.size} selected", style = MaterialTheme.typography.bodySmall, color = SightlineTheme.colors.mutedInk)
                                        }
                                        StudioGlyph(StudioIcon.Chevron)
                                    }
                                }
                            }
                        }
                    }
                    items(state.cameras.filter { camera -> camera.id in selected || camera.streaming || camera.status != "Ready" || state.channels.any { it.id == camera.id } }, key = { it.id }) { camera ->
                        CameraCard(camera, state.channels.firstOrNull { it.id == camera.id }, state.addresses.firstOrNull(), camera.id in selected, state.running, copy, onShare)
                    }
                    item { QualityPanel(if (state.running) state.settings.width > 640 else hd, !state.running) { hd = it } }
                    if (!state.running) item { BrowserPanel(state, copy, onShare) }
                }
            }
        }
        if (selecting && !state.running) CameraPicker(
            cameras = state.cameras, selected = selected, onDismiss = { selecting = false },
            onToggle = { id -> selected = if (id in selected) selected - id else if (selected.size < 5) selected + id else selected },
        )
        if (help) CameraHelp(onDismiss = { help = false })
    }
}

@Composable
private fun StudioHeader(dark: Boolean, onThemeChange: (Boolean) -> Unit, onHelp: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SightlineMark()
        Text("Sightline", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = onHelp, modifier = Modifier.size(48.dp).semantics { contentDescription = "Help" }) {
            StudioGlyph(StudioIcon.Info)
        }
        FilledTonalIconToggleButton(
            checked = dark, onCheckedChange = onThemeChange,
            modifier = Modifier.size(48.dp).semantics { contentDescription = "Dark theme" },
            colors = IconButtonDefaults.filledTonalIconToggleButtonColors(
                containerColor = SightlineTheme.colors.card, contentColor = SightlineTheme.colors.ink,
                checkedContainerColor = SightlineTheme.colors.marigold, checkedContentColor = SightlineTheme.colors.onMarigold,
            ),
        ) { StudioGlyph(if (dark) StudioIcon.Sun else StudioIcon.Moon, color = if (dark) SightlineTheme.colors.onMarigold else SightlineTheme.colors.ink) }
    }
}

@Composable
private fun EmptyCameras() {
    ClayPanel(tone = ClayTone.Sage, radius = 32.dp) {
        HubIllustration()
        Text("No cameras available", style = MaterialTheme.typography.titleLarge)
        Text("Check camera access or connect a USB webcam.")
    }
}

@Composable
private fun CameraCard(camera: CameraSource, channel: ChannelInfo?, base: String?, selected: Boolean, running: Boolean, onCopy: (String) -> Unit, onShare: (String) -> Unit) {
    ClayPanel(radius = 26.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(SightlineTheme.colors.sage), contentAlignment = Alignment.Center) {
                StudioGlyph(StudioIcon.Camera, color = SightlineTheme.colors.sageInk)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(camera.name, style = MaterialTheme.typography.titleMedium)
                Text(if (running) camera.detail else if (camera.kind == CameraKind.PHONE) "Phone camera" else "USB camera", style = MaterialTheme.typography.bodySmall, color = SightlineTheme.colors.mutedInk)
            }
        }
        if (running || camera.status != "Ready") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                StudioGlyph(if (camera.streaming) StudioIcon.Play else StudioIcon.Info, Modifier.size(18.dp), if (camera.streaming) SightlineTheme.colors.live else SightlineTheme.colors.mutedInk)
                Text(camera.status, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (!running) {
            Text(if (selected) "Selected" else "Not selected", style = MaterialTheme.typography.labelMedium,
                color = if (selected) SightlineTheme.colors.marigoldInk else SightlineTheme.colors.mutedInk)
        }
        if (channel != null) {
            if (base != null) {
                val url = "$base/camera/${camera.id}/stream"
                LinkActions(url, "Copy stream", onCopy, onShare)
            }
        }
    }
}

@Composable
private fun QualityPanel(hd: Boolean, enabled: Boolean, onSelect: (Boolean) -> Unit) {
    ClayPanel {
        SectionHeading("Stream quality")
        val largeText = LocalDensity.current.fontScale > 1.2f
        if (largeText) {
            QualityOption("640 × 480", "Recommended", !hd, enabled, { onSelect(false) }, Modifier.fillMaxWidth())
            QualityOption("1280 × 720", "More detail", hd, enabled, { onSelect(true) }, Modifier.fillMaxWidth())
        } else Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            QualityOption("640 × 480", "Recommended", !hd, enabled, { onSelect(false) }, Modifier.weight(1f))
            QualityOption("1280 × 720", "More detail", hd, enabled, { onSelect(true) }, Modifier.weight(1f))
        }
        Text("Up to 20 FPS · MJPEG", style = MaterialTheme.typography.labelMedium)
        if (!enabled) Text("Stop to change quality.", style = MaterialTheme.typography.bodySmall, color = SightlineTheme.colors.mutedInk)
    }
}

@Composable
private fun QualityOption(title: String, detail: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val colors = SightlineTheme.colors
    Surface(
        modifier = modifier.selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        color = if (selected) colors.marigold.copy(alpha = 0.13f) else colors.card,
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) colors.marigoldInk else colors.border),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RadioButton(selected, onClick = null, enabled = enabled, modifier = Modifier.size(20.dp),
                colors = RadioButtonDefaults.colors(selectedColor = colors.marigoldInk, disabledSelectedColor = colors.marigoldInk, unselectedColor = colors.mutedInk))
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = colors.mutedInk)
        }
    }
}

@Composable
private fun BrowserPanel(state: CaptureUiState, onCopy: (String) -> Unit, onShare: (String) -> Unit) {
    ClayPanel(tone = if (state.running) ClayTone.Lilac else ClayTone.Plain) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            StudioGlyph(StudioIcon.Monitor, color = if (state.running) SightlineTheme.colors.lilacInk else SightlineTheme.colors.marigoldInk)
            SectionHeading("Watch in browser", Modifier.weight(1f))
        }
        if (state.running && state.addresses.isNotEmpty()) {
            Text("Open on the same Wi-Fi.")
            state.addresses.forEach { url ->
                LinkWell(url)
                LinkActions(url, "Copy link", onCopy, onShare)
            }
        } else {
            Text(if (state.running) "Connect to Wi-Fi to get your link."
                else "Your link appears when streaming starts.", color = SightlineTheme.colors.ink)
        }
        if (state.running) Text("Anyone on this network with the link can watch.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun LinkWell(url: String) {
    Surface(shape = RoundedCornerShape(12.dp), color = SightlineTheme.colors.card) {
        SelectionContainer { Text(url, Modifier.fillMaxWidth().padding(14.dp), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun LinkActions(url: String, copyLabel: String, onCopy: (String) -> Unit, onShare: (String) -> Unit) {
    // FlowRow allows large accessibility text to wrap the actions instead of clipping them.
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { onCopy(url) }, colors = quietButtonColors()) {
            StudioGlyph(StudioIcon.Copy, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(copyLabel)
        }
        TextButton(onClick = { onShare(url) }, colors = quietButtonColors()) {
            StudioGlyph(StudioIcon.Share, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Share")
        }
    }
}

@Composable
private fun StreamActionBar(state: CaptureUiState, ready: Boolean, selectedCount: Int, onStop: () -> Unit, onStart: () -> Unit) {
    val colors = SightlineTheme.colors
    Surface(color = colors.chalk, shadowElevation = 8.dp) {
        Box(Modifier.fillMaxWidth().navigationBarsPadding(), contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 680.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = if (state.running) onStop else onStart,
                    enabled = ready && (state.running || state.cameras.isNotEmpty()),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 58.dp), shape = RoundedCornerShape(18.dp),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                    elevation = ButtonDefaults.buttonElevation(defaultElevation = 3.dp, pressedElevation = 0.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (state.running) MaterialTheme.colorScheme.errorContainer else colors.marigold,
                        contentColor = if (state.running) colors.live else colors.onMarigold,
                        disabledContainerColor = colors.muted, disabledContentColor = colors.mutedInk,
                    ),
                ) {
                    StudioGlyph(if (state.running) StudioIcon.Stop else if (selectedCount == 0) StudioIcon.Camera else StudioIcon.Play,
                        Modifier.size(20.dp), if (state.running) colors.live else if (state.cameras.isEmpty() || !ready) colors.mutedInk else colors.onMarigold)
                    Spacer(Modifier.width(12.dp))
                    Text(when {
                        state.running -> "Stop streaming"
                        !ready -> "Getting ready…"
                        state.cameras.isEmpty() -> "Connect a camera to begin"
                        selectedCount == 0 -> "Choose cameras"
                        selectedCount == 1 -> "Start streaming"
                        else -> "Start $selectedCount camera streams"
                    })
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CameraPicker(cameras: List<CameraSource>, selected: List<String>, onToggle: (String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = SightlineTheme.colors.chalk) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Choose cameras", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
            Text("${selected.size} selected · maximum 5", color = SightlineTheme.colors.mutedInk)
            LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (cameras.isEmpty()) item { Text("No cameras available. Tap Refresh to check again.") }
                listOf(CameraKind.PHONE, CameraKind.USB).forEach { kind ->
                    val sources = cameras.filter { it.kind == kind }
                    if (sources.isNotEmpty()) item(key = kind.name) { SectionHeading(if (kind == CameraKind.PHONE) "Phone cameras" else "USB cameras") }
                    items(sources, key = { it.id }) { camera ->
                        val checked = camera.id in selected
                        val enabled = checked || selected.size < 5
                        Surface(shape = RoundedCornerShape(20.dp), color = if (checked) SightlineTheme.colors.sage else SightlineTheme.colors.card,
                            modifier = Modifier.fillMaxWidth().toggleable(checked, enabled = enabled, role = Role.Checkbox) { onToggle(camera.id) }) {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(camera.name, style = MaterialTheme.typography.titleSmall)
                                    Text(camera.detail, style = MaterialTheme.typography.bodySmall)
                                    if (!enabled) Text("Five-camera limit reached", style = MaterialTheme.typography.bodySmall)
                                }
                                Checkbox(checked, onCheckedChange = null, enabled = enabled,
                                    colors = CheckboxDefaults.colors(checkedColor = SightlineTheme.colors.sageInk, checkmarkColor = SightlineTheme.colors.card))
                            }
                        }
                    }
                }
            }
            Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(16.dp)) { Text("Done") }
        }
    }
}

@Composable
private fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge)
}

@Composable
private fun quietButtonColors() = ButtonDefaults.textButtonColors(contentColor = SightlineTheme.colors.ink)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CameraHelp(onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = SightlineTheme.colors.chalk) {
        LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { SectionHeading("Camera help") }
            item {
                Text("Phone cameras", style = MaterialTheme.typography.titleMedium)
                Text("Choose Front / selfie, Rear, or another lens listed by Android. Allow camera access when prompted. Some lenses are private to your phone's camera app.")
            }
            item {
                Text("Multiple cameras", style = MaterialTheme.typography.titleMedium)
                Text("Start with one camera, then add another. Phone cameras can run together only in combinations Android supports. You can also select phone and USB cameras together; power and hardware limits still apply.")
            }
            item {
                Text("USB cameras", style = MaterialTheme.typography.titleMedium)
                Text("Use a UVC webcam and a powered USB hub. Connect the hub to your phone and tap Refresh. Enable USB OTG in the phone's Settings if needed.")
            }
            item {
                Text("Viewing and privacy", style = MaterialTheme.typography.titleMedium)
                Text("Put your computer on the same Wi-Fi or phone hotspot, then open the viewing link. Anyone on that network with the link can watch. Sightline doesn't record or upload video.")
            }
            item {
                Text("Quality and rotation", style = MaterialTheme.typography.titleMedium)
                Text("640 × 480 targets up to 20 FPS. Actual resolution and speed depend on camera support. Phone video rotates with the device; portrait streams swap width and height. Selfie video is not mirrored, so text remains readable.")
            }
            item { Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) { Text("Done") } }
        }
    }
}
