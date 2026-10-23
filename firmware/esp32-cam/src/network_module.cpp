#include "app_shared.h"

namespace {
bool shouldShowViewer() {
  return WiFi.status() == WL_CONNECTED &&
         (runtimeMode == RuntimeMode::ConnectedIdle || runtimeMode == RuntimeMode::PostConnectValidation);
}

String buildSetupPage() {
  String page = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32-CAM Setup</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --panel: #101b2d;
      --panel-border: rgba(148, 163, 184, 0.2);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --danger: #ef4444;
      --success: #22c55e;
      --field: #0b1220;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 35%),
        linear-gradient(160deg, #050816, var(--bg));
      color: var(--text);
      padding: 18px;
    }
    .shell {
      max-width: 900px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .card {
      background: rgba(16, 27, 45, 0.95);
      border: 1px solid var(--panel-border);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 24px 60px rgba(2, 6, 23, 0.35);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(28px, 5vw, 44px);
      letter-spacing: -0.04em;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 18px;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }
    .status, .error-box {
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      border: 1px solid transparent;
    }
    .status {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.2);
      color: #dbeafe;
    }
    .status.success {
      background: rgba(34, 197, 94, 0.14);
      border-color: rgba(34, 197, 94, 0.22);
      color: #dcfce7;
    }
    .status.error, .error-box {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.22);
      color: #fee2e2;
    }
    .section-title {
      margin: 14px 0 8px;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    input, button {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: var(--field);
      color: var(--text);
      font-size: 15px;
    }
    input {
      padding: 12px 14px;
      outline: none;
    }
    button {
      padding: 12px 14px;
      cursor: pointer;
      margin-top: 10px;
      font-weight: 700;
    }
    .primary {
      background: linear-gradient(135deg, var(--accent), #0ea5e9);
      border-color: transparent;
      color: #021018;
    }
    .secondary {
      background: rgba(15, 23, 42, 0.85);
    }
    .danger {
      background: rgba(239, 68, 68, 0.14);
      border-color: rgba(239, 68, 68, 0.25);
      color: #fecaca;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 14px;
      margin-top: 10px;
    }
    .toggle input {
      width: auto;
    }
    .networks {
      display: grid;
      gap: 8px;
      max-height: 260px;
      overflow: auto;
      margin-top: 10px;
    }
    .network {
      text-align: left;
      background: rgba(2, 6, 23, 0.26);
      border: 1px solid rgba(148, 163, 184, 0.16);
      margin-top: 0;
    }
    .network span:last-child {
      float: right;
      color: var(--muted);
    }
    .meta {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .meta-row {
      padding: 12px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.26);
      border: 1px solid rgba(148, 163, 184, 0.16);
      font-size: 14px;
    }
    .meta-label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }
    @media (max-width: 860px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <h1>ESP32-CAM Setup</h1>
      <p>Configure Wi-Fi and optional gyro authentication. MQTT servo control works independently of the gyro. SD recording and the record button are disabled because GPIO14/GPIO15 drive the servos; remove the SD card.</p>
    </div>

    <div id="status" class="status">Ready to configure Wi-Fi and optional gyro authentication.</div>
    <div id="lastError" class="error-box" style="display:none;"></div>

    <div class="grid">
      <div class="card">
        <h2>Wi-Fi</h2>
        <button class="secondary" type="button" onclick="scanNetworks()">Scan Networks</button>
        <div id="networks" class="networks"></div>

        <div class="section-title">SSID</div>
        <input id="ssid" type="text" value="__SAVED_SSID__" placeholder="Wi-Fi SSID" autocomplete="off" />

        <div class="section-title">Password</div>
        <input id="password" type="password" placeholder="Wi-Fi password" autocomplete="current-password" />
        <label class="toggle">
          <input id="showPassword" type="checkbox" onchange="togglePassword()" />
          Show password
        </label>
      </div>

      <div class="card">
        <h2>Gyro + Authentication</h2>
        <label class="toggle">
          <input id="gyroEnabled" type="checkbox" __GYRO_CHECKED__ />
          Enable gyro + authentication
        </label>
        <p id="gyroAvailabilityHint" style="margin-top:10px;">Checking gyro hardware availability...</p>

        <div class="section-title">Validation Route</div>
        <input id="validationRoute" type="text" value="__SAVED_ROUTE__" placeholder="https://your-backend" />

        <div class="section-title">Email (optional if UUID already exists)</div>
        <input id="email" type="text" placeholder="Email" autocomplete="username" />

        <div class="section-title">Password (optional if UUID already exists)</div>
        <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password" />

        <button class="primary" type="button" onclick="saveAndConnect()">Save & Apply</button>
        <button class="danger" type="button" onclick="forgetWiFi()">Clear Saved Wi-Fi</button>
      </div>
    </div>

    <div class="card">
      <h2>Live Status</h2>
      <div class="meta">
        <div class="meta-row"><span class="meta-label">Mode</span><span id="modeValue">SoftApConfig</span></div>
        <div class="meta-row"><span class="meta-label">Connected IP</span><span id="stationIpValue">-</span></div>
        <div class="meta-row"><span class="meta-label">SD Card</span><span id="sdValue">Disabled for servos</span></div>
        <div class="meta-row"><span class="meta-label">Time Sync</span><span id="timeValue">Not synced</span></div>
        <div class="meta-row"><span class="meta-label">Recording</span><span id="recordingValue">Disabled for servos</span></div>
        <div class="meta-row"><span class="meta-label">Servo angles</span><span id="servoAnglesValue">Waiting...</span></div>
        <div class="meta-row"><span class="meta-label">Servo MQTT</span><span id="servoMqttValue">Waiting...</span></div>
        <div class="meta-row"><span class="meta-label">Servo topic</span><span id="servoTopicValue" style="overflow-wrap:anywhere;">-</span></div>
      </div>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);

    function setStatus(message, kind = 'info') {
      const node = $('status');
      node.className = 'status' + (kind && kind !== 'info' ? ' ' + kind : '');
      node.textContent = message;
    }

    function togglePassword() {
      $('password').type = $('showPassword').checked ? 'text' : 'password';
    }

    function renderLastError(type, message) {
      const box = $('lastError');
      if (!message) {
        box.style.display = 'none';
        box.textContent = '';
        return;
      }
      box.style.display = 'block';
      box.textContent = 'Previous failure (' + type + '): ' + message;
    }

    function renderNetworks(networks) {
      const list = $('networks');
      list.innerHTML = '';
      networks.forEach((network) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'network';
        const name = document.createElement('span');
        const signal = document.createElement('span');
        name.textContent = network.ssid;
        signal.textContent = network.rssi + ' dBm';
        item.append(name, signal);
        item.onclick = () => {
          $('ssid').value = network.ssid === '(hidden)' ? '' : network.ssid;
        };
        list.appendChild(item);
      });
    }

    function updateGyroAvailability(status) {
      const available = !!status.gyroAvailable;
      const enabled = $('gyroEnabled');
      const hint = $('gyroAvailabilityHint');
      const route = $('validationRoute');
      const email = $('email');
      const authPassword = $('authPassword');

      hint.textContent = available
        ? 'Gyro hardware detected. Keep it still during startup calibration.'
        : 'Gyro not detected on GPIO3/GPIO13. Saved settings are retained; the device will retry.';
    }

    async function refreshStatus() {
      try {
        const response = await fetch('/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const status = await response.json();

        $('modeValue').textContent = status.mode;
        $('stationIpValue').textContent = status.stationIp || '-';
        $('sdValue').textContent = 'Disabled for servos (GPIO14/GPIO15)';
        $('timeValue').textContent = status.timeSynced ? 'Synced' : 'Not synced';
        $('recordingValue').textContent = 'Disabled for servos';
        $('servoAnglesValue').textContent = 'X ' + status.servoX + '° · Y ' + status.servoY + '°';
        $('servoMqttValue').textContent = status.servoError || (!status.servoReady ? 'PWM unavailable' : (status.servoMqttConnected ? 'Ready for commands' : 'Connecting / offline'));
        $('servoTopicValue').textContent = status.servoTopic || '-';
        updateGyroAvailability(status);

        renderLastError(status.lastErrorType, status.lastErrorMessage);

        if (status.scanInProgress) {
          setStatus('Scanning for Wi-Fi networks...', 'info');
        } else if (status.scanError) {
          setStatus(status.scanError, 'error');
        } else if (Array.isArray(status.networks) && status.networks.length) {
          renderNetworks(status.networks);
        }

        if (status.mode === 'WifiConnecting') {
          setStatus('Connecting to Wi-Fi...', 'info');
        } else if (status.mode === 'PostConnectValidation') {
          setStatus('Wi-Fi connected. Holding success status before switching modes.', 'success');
        } else if (status.mode === 'ErrorFallback') {
          setStatus('Configuration failed. Returning to setup mode.', 'error');
        } else if (status.mode === 'ConnectedIdle') {
          setStatus('Connected to Wi-Fi. The viewer page is available at /.', 'success');
        }
      } catch (error) {
        setStatus('Unable to fetch device status.', 'error');
      } finally {
        setTimeout(refreshStatus, 1000);
      }
    }

    async function scanNetworks() {
      try {
        const response = await fetch('/scan', { cache: 'no-store' });
        const result = await response.json();
        if (result.error) {
          setStatus(result.error, 'error');
          return;
        }
        if (result.inProgress) {
          setStatus('Scanning for Wi-Fi networks...', 'info');
        } else {
          renderNetworks(result.networks || []);
        }
      } catch (error) {
        setStatus('Wi-Fi scan request failed.', 'error');
      }
    }

    async function saveAndConnect() {
      const ssid = $('ssid').value;
      const password = $('password').value;
      const gyroEnabled = $('gyroEnabled').checked ? '1' : '0';
      const validationRoute = $('validationRoute').value.trim();
      const email = $('email').value.trim();
      const authPassword = $('authPassword').value;

      if (!ssid) {
        setStatus('SSID is required.', 'error');
        return;
      }

      if (gyroEnabled === '1' && validationRoute.length === 0) {
        setStatus('Validation route is required when gyro is enabled.', 'error');
        return;
      }

      if ((email.length > 0 && authPassword.length === 0) || (email.length === 0 && authPassword.length > 0)) {
        setStatus('Enter both email and password, or leave both empty.', 'error');
        return;
      }

      setStatus('Applying configuration...', 'info');

      try {
        const response = await fetch('/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ ssid, password, gyroEnabled, validationRoute, email, authPassword })
        });
        const result = await response.json();
        if (!result.success) {
          setStatus(result.error || 'Unable to start configuration.', 'error');
          return;
        }

        setStatus('Configuration accepted. Waiting for the device to finish applying it.', 'info');
      } catch (error) {
        setStatus('Configuration request failed.', 'error');
      }
    }

    async function forgetWiFi() {
      try {
        const response = await fetch('/forget', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          $('ssid').value = '';
          $('password').value = '';
          setStatus('Saved Wi-Fi credentials cleared.', 'success');
        } else {
          setStatus('Failed to clear saved Wi-Fi credentials.', 'error');
        }
      } catch (error) {
        setStatus('Failed to clear saved Wi-Fi credentials.', 'error');
      }
    }

    refreshStatus();
    scanNetworks();
  </script>
</body>
</html>
)rawliteral";

  page.replace("__SAVED_SSID__", escapeHtml(savedSsidCache));
  page.replace("__SAVED_ROUTE__", escapeHtml(getGyroValidationRoute()));
  page.replace("__GYRO_CHECKED__", isGyroToggleEnabled() ? "checked" : "");
  return page;
}

String buildViewerPage() {
  String page = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32-CAM Viewer</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --panel: rgba(15, 23, 42, 0.94);
      --panel-border: rgba(148, 163, 184, 0.18);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 32%),
        linear-gradient(160deg, #050816, var(--bg));
      padding: 18px;
    }
    .shell {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr);
      gap: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 24px 60px rgba(2, 6, 23, 0.35);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(28px, 5vw, 44px);
      letter-spacing: -0.04em;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }
    .status {
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.2);
      color: #dbeafe;
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.5;
    }
    .stream-wrap {
      position: relative;
      aspect-ratio: 3 / 4;
      border-radius: 16px;
      overflow: hidden;
      background: #020617;
      border: 1px solid rgba(148, 163, 184, 0.18);
    }
    img {
      display: block;
      position: absolute;
      left: 50%;
      top: 50%;
      width: 100%;
      height: 100%;
      transform: translate(-50%, -50%);
      object-fit: contain;
      background: #020617;
    }
    .hidden {
      display: none;
    }
    .meta {
      display: grid;
      gap: 10px;
    }
    .meta-row {
      padding: 12px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.26);
      border: 1px solid rgba(148, 163, 184, 0.16);
      font-size: 14px;
    }
    .meta-label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    a {
      color: #bae6fd;
    }
    @media (max-width: 900px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <h1>Camera Feed</h1>
      <p>Live preview at <span id="captureResolution">the camera resolution</span>, targeting 20 FPS, with X/Y servos controlled by MQTT degree deltas. SD recording and the record button are disabled; GPIO14/GPIO15 drive the servos. Remove the SD card.</p>
    </div>

    <div class="grid">
      <div class="card">
        <div id="streamStatus" class="status">Waiting for status...</div>
        <div id="streamWrap" class="stream-wrap">
          <img id="streamImage" alt="Live MJPEG stream" />
        </div>
      </div>

      <div class="card">
        <div class="meta">
          <div class="meta-row"><label class="meta-label" for="rotation">Preview rotation</label><select id="rotation">
            <option value="0">0° — native orientation</option><option value="90">90° clockwise</option>
            <option value="-90">90° counterclockwise</option><option value="180">180°</option>
          </select><p>Quarter turns display as <span id="quarterTurnResolution">the swapped resolution</span>.</p></div>
          <div class="meta-row"><span class="meta-label">Performance</span><span id="performanceValue">Waiting...</span></div>
          <div class="meta-row"><span class="meta-label">Device message</span><span id="errorValue">None</span></div>
          <div class="meta-row"><span class="meta-label">Host</span><span>esp32.local</span></div>
          <div class="meta-row"><span class="meta-label">Station IP</span><span id="stationIpValue">-</span></div>
          <div class="meta-row"><span class="meta-label">Recording</span><span id="recordingValue">Disabled for servos</span></div>
          <div class="meta-row"><span class="meta-label">Servo angles</span><span id="servoAnglesValue">Waiting...</span></div>
          <div class="meta-row"><span class="meta-label">Servo MQTT</span><span id="servoMqttValue">Waiting...</span></div>
          <div class="meta-row"><span class="meta-label">Servo topic</span><span id="servoTopicValue" style="overflow-wrap:anywhere;">-</span></div>
          <div class="meta-row"><span class="meta-label">Time Sync</span><span id="timeValue">Not synced</span></div>
          <div class="meta-row"><span class="meta-label">Setup</span><span><a href="/setup">Open configuration page</a></span></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const statusNode = document.getElementById('streamStatus');
    const streamWrap = document.getElementById('streamWrap');
    const streamImage = document.getElementById('streamImage');

    const rotationControl = document.getElementById('rotation');
    let nextStreamAttempt = 0;
    let lastPreviewFrames = -1;
    let lastPreviewProgress = Date.now();
    let activeStreamUrl = '';
    let frameWidth = 600;
    let frameHeight = 800;
    let rotationPreferenceKey = '';

    function applyRotation(value) {
      const angle = [0, 90, -90, 180].includes(Number(value)) ? Number(value) : 0;
      rotationControl.value = String(angle);
      const quarterTurn = Math.abs(angle) === 90;
      streamWrap.style.aspectRatio = String(quarterTurn ? frameHeight / frameWidth : frameWidth / frameHeight);
      streamImage.style.width = quarterTurn ? (frameWidth / frameHeight * 100) + '%' : '100%';
      streamImage.style.height = quarterTurn ? (frameHeight / frameWidth * 100) + '%' : '100%';
      streamImage.style.transform = 'translate(-50%, -50%) rotate(' + angle + 'deg)';
      if (rotationPreferenceKey) {
        try { localStorage.setItem(rotationPreferenceKey, String(angle)); } catch (_) {}
      }
    }
    applyRotation(0);
    rotationControl.addEventListener('change', () => applyRotation(rotationControl.value));

    function resetStream() {
      streamImage.removeAttribute('src');
      nextStreamAttempt = Date.now() + 2000;
      activeStreamUrl = '';
    }
    streamImage.addEventListener('error', resetStream);

    function updateStreamAvailability(available) {
      if (available) {
        streamWrap.classList.remove('hidden');
        if (!activeStreamUrl && Date.now() >= nextStreamAttempt) {
          const url = new URL('/stream', window.location.href);
          url.port = '81';
          url.searchParams.set('ts', Date.now());
          activeStreamUrl = url.href;
          streamImage.src = activeStreamUrl;
          lastPreviewProgress = Date.now();
        }
        statusNode.textContent = 'Live preview enabled.';
        return;
      }
      streamWrap.classList.add('hidden');
      resetStream();
      statusNode.textContent = 'The camera preview is currently unavailable.';
    }

    async function refreshStatus() {
      try {
        const response = await fetch('/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const status = await response.json();

        document.getElementById('stationIpValue').textContent = status.stationIp || '-';
        const hasDimensions = Number.isInteger(status.width) && Number.isInteger(status.height) && status.width > 0 && status.height > 0;
        if (hasDimensions) {
          // Keep each native orientation's receiver rotation independent.
          const preferenceKey = 'cameraNativeRotation:' + (status.width < status.height ? 'portrait' : 'landscape');
          const orientationChanged = rotationPreferenceKey !== preferenceKey;
          const dimensionsChanged = frameWidth !== status.width || frameHeight !== status.height;
          frameWidth = status.width;
          frameHeight = status.height;
          if (orientationChanged) {
            rotationPreferenceKey = preferenceKey;
            let savedRotation = '0';
            try { savedRotation = localStorage.getItem(preferenceKey) ?? '0'; } catch (_) {}
            applyRotation(savedRotation);
          } else if (dimensionsChanged) {
            applyRotation(rotationControl.value);
          }
        }
        document.getElementById('captureResolution').textContent = hasDimensions ? status.width + ' × ' + status.height : 'unavailable';
        document.getElementById('quarterTurnResolution').textContent = hasDimensions ? status.height + ' × ' + status.width : 'unavailable';
        document.getElementById('recordingValue').textContent = 'Disabled for servos';
        document.getElementById('servoAnglesValue').textContent = 'X ' + status.servoX + '° · Y ' + status.servoY + '°';
        document.getElementById('servoMqttValue').textContent = status.servoError || (!status.servoReady ? 'PWM unavailable' : (status.servoMqttConnected ? 'Ready for commands' : 'Connecting / offline'));
        document.getElementById('servoTopicValue').textContent = status.servoTopic || '-';
        document.getElementById('timeValue').textContent = status.timeSynced ? 'Synced' : 'Not synced';

        document.getElementById('performanceValue').textContent =
          status.capturedFrames + ' captured · ' + status.previewFrames + ' previewed · ' + status.captureErrors + ' capture errors';
        document.getElementById('errorValue').textContent = status.servoError || status.mediaError || status.lastErrorMessage || status.gyroError || 'None';
        if (status.previewFrames !== lastPreviewFrames) {
          lastPreviewFrames = status.previewFrames;
          lastPreviewProgress = Date.now();
        } else if (activeStreamUrl && Date.now() - lastPreviewProgress > 15000) {
          resetStream();
        }
        updateStreamAvailability(status.streamAvailable);
      } catch (error) {
        statusNode.textContent = 'Unable to fetch current device status. Reconnecting...';
      } finally {
        setTimeout(refreshStatus, 1000);
      }
    }

    refreshStatus();
  </script>
</body>
</html>
)rawliteral";

  return page;
}

void sendJson(const String& json) {
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", json);
}

void handleRoot() {
  server.sendHeader("Cache-Control", "no-store");
  if (shouldShowViewer()) {
    server.send(200, "text/html", buildViewerPage());
    return;
  }

  server.send(200, "text/html", buildSetupPage());
}

void handleSetup() {
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html", buildSetupPage());
}

void handleStatus() {
  sendJson(buildStatusJson());
}

void handleScan() {
  scanNetworksAsync();
  String json = "{";
  json += "\"inProgress\":";
  json += scanState.inProgress ? "true" : "false";
  json += ",\"error\":\"" + escapeJson(scanState.error) + "\"";
  json += ",\"networks\":";
  json += scanState.jsonCache;
  json += "}";
  sendJson(json);
}

void handleConnect() {
  if (runtimeMode == RuntimeMode::WifiConnecting || runtimeMode == RuntimeMode::PostConnectValidation) {
    sendJson("{\"success\":false,\"error\":\"A connection attempt is already in progress\"}");
    return;
  }

  String ssid = server.arg("ssid");
  String password = server.arg("password");
  String gyroEnabledArg = server.arg("gyroEnabled");
  String validationRoute = server.arg("validationRoute");
  String email = server.arg("email");
  String authPassword = server.arg("authPassword");

  validationRoute.trim();
  email.trim();
  gyroEnabledArg.toLowerCase();

  bool requestedGyroEnabled = (gyroEnabledArg == "1" || gyroEnabledArg == "true" || gyroEnabledArg == "on");

  if (ssid.length() > 32 || password.length() > 64 || validationRoute.length() > 512 ||
      email.length() > 254 || authPassword.length() > 256) {
    sendJson("{\"success\":false,\"error\":\"Configuration field exceeds its length limit\"}");
    return;
  }

  if (ssid.length() == 0) {
    sendJson("{\"success\":false,\"error\":\"SSID is required\"}");
    return;
  }

  if (requestedGyroEnabled && validationRoute.length() == 0) {
    sendJson("{\"success\":false,\"error\":\"Validation route is required when gyro is enabled\"}");
    return;
  }

  bool hasEmail = email.length() > 0;
  bool hasPassword = authPassword.length() > 0;
  if (hasEmail != hasPassword) {
    sendJson("{\"success\":false,\"error\":\"Enter both email and password, or leave both empty\"}");
    return;
  }

  PendingConnectionRequest request;
  request.active = true;
  request.keepAccessPoint = apActive || runtimeMode == RuntimeMode::SoftApConfig || runtimeMode == RuntimeMode::ErrorFallback;
  request.ssid = ssid;
  request.password = password;
  request.gyroEnabled = requestedGyroEnabled;
  request.validationRoute = validationRoute;
  request.email = email;
  request.authPassword = authPassword;

  sendJson("{\"success\":true,\"saved\":false,\"wifiConnected\":false,\"gyroReady\":false,\"recordingReady\":false,\"enteredSoftAp\":false,\"applying\":true,\"lastErrorType\":\"none\",\"lastErrorMessage\":\"\"}");
  startConnectionAttempt(request);
}

void handleForget() {
  clearCredentials();
  clearConnectionError();
  sendJson("{\"success\":true}");
  startConfigMode();
}

// Use the SDK's streaming raw-body path, before its normal form parser allocates
// the entire Content-Length. Only our small URL-encoded configuration is accepted.
class BoundedPostHandler : public RequestHandler {
 public:
  bool canHandle(HTTPMethod method, String uri) override {
    return method == HTTP_POST || method == HTTP_PUT || method == HTTP_PATCH || method == HTTP_DELETE;
  }
  bool canRaw(String uri) override { return true; }
  void raw(WebServer& web, String uri, HTTPRaw& request) override {
    if (request.status == RAW_START) {
      body = "";
      complete = false;
      startedAt = millis();
      rejected = false;
      expected = 0;
      const String length = web.header("Content-Length");
      for (size_t i = 0; i < length.length(); ++i) {
        if (length[i] < '0' || length[i] > '9' || expected > kBodyLimit / 10) {
          reject(web, 413, "Request is too large or has an invalid length");
          return;
        }
        expected = expected * 10 + length[i] - '0';
      }
      if (expected > kBodyLimit) {
        reject(web, 413, "Request body limit is 4096 bytes");
        return;
      }
      String type = web.header("Content-Type");
      if (expected && !type.startsWith("application/x-www-form-urlencoded")) {
        reject(web, 415, "Use URL-encoded form data");
        return;
      }
      // The SDK otherwise reads a full 1436-byte block even for a tiny body.
      // Read only Content-Length bytes here, with one deadline for the request.
      server.markRawBodyConsumed();
      if (expected && !body.reserve(expected)) {
        reject(web, 503, "Not enough memory for configuration");
        return;
      }
      WiFiClient input = web.client();
      while (body.length() < expected) {
        if (millis() - startedAt >= 4000 || (!input.connected() && !input.available())) {
          reject(web, 408, "Configuration request timed out or was incomplete");
          return;
        }
        if (input.available()) {
          const int value = input.read();
          if (value >= 0 && !body.concat(static_cast<char>(value))) {
            reject(web, 503, "Not enough memory for configuration");
            return;
          }
        } else {
          delay(1);
        }
      }
    } else if (request.status == RAW_END) {
      complete = !rejected && body.length() == expected;
    } else if (request.status == RAW_ABORTED) {
      body = "";
      complete = false;
    }
  }
  bool handle(WebServer& web, HTTPMethod method, String uri) override {
    if (!complete || (expected && !web.header("Content-Type").startsWith("application/x-www-form-urlencoded"))) {
      web.send(400, "text/plain", "Incomplete or unsupported request body");
    } else if (method != HTTP_POST || (uri != "/connect" && uri != "/forget")) {
      web.send(404, "text/plain", "Not found");
    } else {
      // Bound the SDK argument-array allocation as well as body bytes.
      size_t fields = 1;
      for (size_t i = 0; i < body.length(); ++i) if (body[i] == '&') ++fields;
      if (fields > 8) {
        web.send(400, "text/plain", "Too many configuration fields");
      } else {
        server.parseBoundedForm(body);
        if (uri == "/connect") handleConnect();
        else handleForget();
      }
    }
    body = "";
    complete = false;
    return true;
  }
 private:
  static constexpr size_t kBodyLimit = 4096;
  String body;
  size_t expected = 0;
  uint32_t startedAt = 0;
  bool complete = false;
  bool rejected = false;
  void reject(WebServer& web, int code, const char* message) {
    rejected = true;
    server.markRawBodyConsumed();
    web.send(code, "text/plain", message);
    web.client().stop();
    body = "";
    complete = false;
  }
};

void handleCaptivePortalRedirect() {
  server.sendHeader("Location", "/setup");
  server.send(302, "text/plain", "");
}

void handleNoContent() {
  server.send(204, "text/plain", "");
}

void handleNotFound() {
  if (!shouldShowViewer()) {
    server.sendHeader("Location", "/setup");
    server.send(302, "text/plain", "");
    return;
  }

  server.send(404, "text/plain", "Not found");
}
}  // namespace

void registerRoutes() {
  const char* requestHeaders[] = {"Content-Length", "Content-Type"};
  server.collectHeaders(requestHeaders, 2);
  server.addHandler(new BoundedPostHandler());
  server.on("/", HTTP_GET, handleRoot);
  server.on("/setup", HTTP_GET, handleSetup);
  server.on("/setup/", HTTP_GET, handleSetup);
  server.on("/stream", HTTP_GET, handleStream);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/scan", HTTP_GET, handleScan);
  server.on("/generate_204", HTTP_GET, handleCaptivePortalRedirect);
  server.on("/gen_204", HTTP_GET, handleCaptivePortalRedirect);
  server.on("/hotspot-detect.html", HTTP_GET, handleCaptivePortalRedirect);
  server.on("/connecttest.txt", HTTP_GET, handleCaptivePortalRedirect);
  server.on("/ncsi.txt", HTTP_GET, handleCaptivePortalRedirect);
  server.on("/success.txt", HTTP_GET, handleCaptivePortalRedirect);
  server.on("/wpad.dat", HTTP_GET, handleNoContent);
  server.on("/favicon.ico", HTTP_GET, handleNoContent);
  server.onNotFound(handleNotFound);
}
