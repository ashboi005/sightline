#include "app_shared.h"
#include "servo_module.h"
#include "esp_wifi.h"
#include <time.h>

const char kAccessPointSsid[] = "ESP32-CAM-Setup";
const char kAccessPointPassword[] = "12345678";
const char kMdnsHost[] = "esp32";
const uint16_t kDnsPort = 53;
const unsigned long kWifiConnectTimeoutMs = 15000;
const unsigned long kStatusHoldMs = 15000;
const unsigned long kErrorHoldMs = 3000;
const unsigned long kFastBlinkIntervalMs = 100;
const unsigned long kSlowBlinkIntervalMs = 500;
const unsigned long kRecordingFrameIntervalMs = 50;
const unsigned long kButtonDebounceMs = 50;
// User-requested 1-bit SD wiring plan:
// - LED on GPIO4
// - record button on GPIO12
const uint8_t kIndicatorLedPin = 4;
const uint8_t kRecordButtonPin = 12;

const IPAddress kApIp(192, 168, 4, 1);
const IPAddress kApSubnet(255, 255, 255, 0);

AppWebServer server(80);
DNSServer dnsServer;
Preferences preferences;

bool cameraReady = false;
bool apActive = false;
bool mdnsActive = false;
bool httpServerStarted = false;
bool sdReady = false;
bool timeSyncStarted = false;
bool timeSynced = false;

RuntimeMode runtimeMode = RuntimeMode::SoftApConfig;
PendingConnectionRequest pendingConnection;
RecordingSession recordingSession;
ScanState scanState;
unsigned long runtimeModeStartedAt = 0;
bool startApWhenErrorWindowEnds = false;
String savedSsidCache;
String savedPasswordCache;

namespace {
constexpr char kSsidKey[] = "ssid";
constexpr char kPasswordKey[] = "pass";
constexpr char kLegacyPasswordKey[] = "password";
constexpr char kErrorTypeKey[] = "last_err_type";
constexpr char kErrorMessageKey[] = "last_err_msg";
constexpr time_t kValidTimeThreshold = 1700000000;
constexpr long kLocalUtcOffsetSeconds = 19800;  // Asia/Calcutta (UTC+05:30)

ErrorType sLastErrorType = ErrorType::None;
String sLastErrorMessage;
RuntimeMode sErrorReturnMode = RuntimeMode::SoftApConfig;
bool sPreviewServerReady = false;
uint32_t sLastReconnectAttempt = 0;

void removePreferenceKeyIfPresent(const char* key) {
  if (preferences.isKey(key)) {
    preferences.remove(key);
  }
}

bool pinConflictsWithSd1Bit(uint8_t pin) {
  return pin == 2 || pin == 14 || pin == 15;
}

bool pinConflictsWithCamera(uint8_t pin) {
  return pin == XCLK_GPIO_NUM ||
         pin == SIOD_GPIO_NUM ||
         pin == SIOC_GPIO_NUM ||
         pin == Y2_GPIO_NUM ||
         pin == Y3_GPIO_NUM ||
         pin == Y4_GPIO_NUM ||
         pin == Y5_GPIO_NUM ||
         pin == Y6_GPIO_NUM ||
         pin == Y7_GPIO_NUM ||
         pin == Y8_GPIO_NUM ||
         pin == Y9_GPIO_NUM ||
         pin == VSYNC_GPIO_NUM ||
         pin == HREF_GPIO_NUM ||
         pin == PCLK_GPIO_NUM ||
         pin == PWDN_GPIO_NUM;
}

void enterRuntimeMode(RuntimeMode mode) {
  runtimeMode = mode;
  runtimeModeStartedAt = millis();
}

ErrorType parseErrorType(const String& input) {
  String normalized = input;
  normalized.toLowerCase();

  if (normalized == "wifi") {
    return ErrorType::WiFi;
  }
  if (normalized == "gyro") {
    return ErrorType::Gyro;
  }
  if (normalized == "disconnect") {
    return ErrorType::Disconnect;
  }
  if (normalized == "sdcard") {
    return ErrorType::SDCard;
  }
  if (normalized == "recording") {
    return ErrorType::Recording;
  }
  return ErrorType::None;
}

String wifiFailureMessage() {
  switch (WiFi.status()) {
    case WL_NO_SSID_AVAIL:
      return "Configured Wi-Fi network is not available";
    case WL_CONNECT_FAILED:
      return "Wi-Fi authentication failed";
    case WL_CONNECTION_LOST:
      return "Wi-Fi connection was lost";
    case WL_DISCONNECTED:
      return "Wi-Fi did not connect in time";
    default:
      return "Unable to connect to Wi-Fi using the supplied credentials";
  }
}

void applyConnectedRadioTuning() {
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
}

void updateLedOutput() {
  if (!indicatorPinUsable()) {
    return;
  }

  bool ledOn = false;

  if (recordingSession.active || runtimeMode == RuntimeMode::PostConnectValidation) {
    ledOn = true;
  } else if (runtimeMode == RuntimeMode::WifiConnecting) {
    ledOn = ((millis() / kSlowBlinkIntervalMs) % 2) == 0;
  } else if (runtimeMode == RuntimeMode::ErrorFallback) {
    ledOn = ((millis() / kFastBlinkIntervalMs) % 2) == 0;
  }

  digitalWrite(kIndicatorLedPin, ledOn ? HIGH : LOW);
}

void updateRecordButtonState() {
  if (!recordButtonPinUsable()) {
    return;
  }

  bool physicalPressed = digitalRead(kRecordButtonPin) == LOW;

  if (physicalPressed != recordingSession.lastPhysicalPressed) {
    recordingSession.lastPhysicalPressed = physicalPressed;
    recordingSession.lastDebounceAt = millis();
  }

  if (millis() - recordingSession.lastDebounceAt < kButtonDebounceMs) {
    return;
  }

  if (recordingSession.stablePressed == physicalPressed) {
    return;
  }

  recordingSession.stablePressed = physicalPressed;
  if (recordingSession.stablePressed) {
    Serial.println("Record button click detected (debounced)");
    recordingSession.clickPending = true;
  }

}

bool recordingCanStartNow() {
  return recordButtonPinUsable() && cameraReady && sdReady &&
         !recordingSession.active && !mediaStatus().recording;
}

String formatTimestampDirectory() {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 10)) {
    return "";
  }

  char buffer[40];
  snprintf(
    buffer,
    sizeof(buffer),
    "/recordings/%04d-%02d-%02d_%02d-%02d-%02d",
    timeInfo.tm_year + 1900,
    timeInfo.tm_mon + 1,
    timeInfo.tm_mday,
    timeInfo.tm_hour,
    timeInfo.tm_min,
    timeInfo.tm_sec
  );

  String candidate = buffer;
  if (!SD_MMC.exists(candidate.c_str())) {
    return candidate;
  }

  for (uint16_t suffix = 1; suffix < 1000; ++suffix) {
    String suffixed = candidate + "_" + String(suffix);
    if (!SD_MMC.exists(suffixed.c_str())) {
      return suffixed;
    }
  }

  return "";
}

String buildNumericRecordingDirectory() {
  uint32_t next = preferences.getULong("rec_next", 1);
  for (unsigned attempt = 0; attempt < 1000; ++attempt) {
    if (next == 0) next = 1;
    String candidate = "/recordings/" + String(next++);
    if (!SD_MMC.exists(candidate.c_str())) {
      preferences.putULong("rec_next", next);
      return candidate;
    }
  }
  return "";
}

bool ensureRecordingsRoot() {
  if (!SD_MMC.exists("/recordings")) {
    return SD_MMC.mkdir("/recordings");
  }
  File directory = SD_MMC.open("/recordings");
  return directory && directory.isDirectory();
}

bool prepareAndCommitConnection() {
  if (!pendingConnection.active) {
    return false;
  }

  bool candidateEnabled = false;
  String candidateRoute;
  String candidateUuid;
  String gyroMessage;
  bool uuidUpdated = false;

  // Wi-Fi and the camera remain usable even if optional gyro authentication fails.
  const bool gyroConfigured = prepareGyroConfiguration(
      pendingConnection.gyroEnabled, pendingConnection.validationRoute,
      pendingConnection.email, pendingConnection.authPassword,
      candidateEnabled, candidateRoute, candidateUuid, gyroMessage, uuidUpdated);
  saveCredentials(pendingConnection.ssid, pendingConnection.password);
  if (gyroConfigured) {
    saveGyroSettings(candidateEnabled, candidateRoute, candidateUuid);
    clearConnectionError();
  } else {
    persistConnectionError(ErrorType::Gyro, gyroMessage);
  }
  pendingConnection = PendingConnectionRequest();
  beginSuccessWindow();
  return true;
}
}  // namespace

String escapeJson(const String& input) {
  String output;
  output.reserve(input.length() + 8);
  for (size_t i = 0; i < input.length(); ++i) {
    char c = input[i];
    switch (c) {
      case '\\': output += "\\\\"; break;
      case '"': output += "\\\""; break;
      case '\n': output += "\\n"; break;
      case '\r': output += "\\r"; break;
      case '\t': output += "\\t"; break;
      default:
        if (static_cast<uint8_t>(c) < 0x20) {
          char escaped[7];
          snprintf(escaped, sizeof(escaped), "\\u%04x", static_cast<unsigned char>(c));
          output += escaped;
        } else {
          output += c;
        }
        break;
    }
  }
  return output;
}

String escapeHtml(const String& input) {
  String output;
  output.reserve(input.length() + 16);
  for (size_t i = 0; i < input.length(); ++i) {
    char c = input[i];
    switch (c) {
      case '&': output += "&amp;"; break;
      case '<': output += "&lt;"; break;
      case '>': output += "&gt;"; break;
      case '"': output += "&quot;"; break;
      case '\'': output += "&#39;"; break;
      default: output += c; break;
    }
  }
  return output;
}

String runtimeModeText() {
  switch (runtimeMode) {
    case RuntimeMode::SoftApConfig: return "SoftApConfig";
    case RuntimeMode::WifiConnecting: return "WifiConnecting";
    case RuntimeMode::PostConnectValidation: return "PostConnectValidation";
    case RuntimeMode::ConnectedIdle: return "ConnectedIdle";
    case RuntimeMode::ErrorFallback: return "ErrorFallback";
  }
  return "Unknown";
}

String errorTypeText(ErrorType type) {
  switch (type) {
    case ErrorType::WiFi: return "wifi";
    case ErrorType::Gyro: return "gyro";
    case ErrorType::Disconnect: return "disconnect";
    case ErrorType::SDCard: return "sdcard";
    case ErrorType::Recording: return "recording";
    case ErrorType::None:
    default:
      return "none";
  }
}

ErrorType lastConnectionErrorType() {
  return sLastErrorType;
}

String lastConnectionErrorMessage() {
  return sLastErrorMessage;
}

bool startAccessPoint() {
  if (apActive) {
    return true;
  }

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(kApIp, kApIp, kApSubnet);
  if (!WiFi.softAP(kAccessPointSsid, kAccessPointPassword)) {
    Serial.println("Access point start failed");
    return false;
  }

  dnsServer.start(kDnsPort, "*", kApIp);
  apActive = true;
  startHttpServerIfNeeded();

  Serial.print("AP SSID: ");
  Serial.println(kAccessPointSsid);
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());
  return true;
}

void stopAccessPoint() {
  if (!apActive) {
    return;
  }

  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  apActive = false;

  if (WiFi.status() == WL_CONNECTED) {
    WiFi.mode(WIFI_STA);
  }
}

void startConfigMode() {
  pendingConnection = PendingConnectionRequest();
  startApWhenErrorWindowEnds = false;
  stopMdnsService();

  if (!apActive) {
    startAccessPoint();
  }

  requestStreamStop();
  WiFi.disconnect(false, false);

  gyroStop();
  enterRuntimeMode(RuntimeMode::SoftApConfig);
}

void enterErrorFallback(ErrorType type, const String& message, bool startApNow, RuntimeMode returnMode) {
  Serial.print("Error fallback [");
  Serial.print(errorTypeText(type));
  Serial.print("]: ");
  Serial.println(message);

  persistConnectionError(type, message);
  pendingConnection = PendingConnectionRequest();
  gyroStop();
  requestStreamStop();
  sErrorReturnMode = returnMode;

  bool shouldReturnToSoftAp = (returnMode == RuntimeMode::SoftApConfig);
  if (shouldReturnToSoftAp) {
    stopMdnsService();
  }

  startApWhenErrorWindowEnds = shouldReturnToSoftAp && !startApNow;

  if (shouldReturnToSoftAp && startApNow) {
    startAccessPoint();
  }

  if (shouldReturnToSoftAp) {
    WiFi.disconnect(false, false);
  }

  enterRuntimeMode(RuntimeMode::ErrorFallback);
}

bool startConnectionAttempt(const PendingConnectionRequest& request) {
  if (request.ssid.length() == 0) {
    return false;
  }

  sLastReconnectAttempt = millis();
  pendingConnection = request;
  pendingConnection.active = true;
  stopMdnsService();
  gyroStop();
  requestStreamStop();

  WiFi.setHostname(kMdnsHost);
  WiFi.setAutoReconnect(false);  // Reconnect explicitly with a bounded retry interval.

  if (pendingConnection.keepAccessPoint) {
    startAccessPoint();
    WiFi.mode(WIFI_AP_STA);
  } else {
    stopAccessPoint();
    WiFi.mode(WIFI_STA);
  }

  WiFi.disconnect(false, false);
  delay(50);

  if (pendingConnection.password.length() > 0) {
    WiFi.begin(pendingConnection.ssid.c_str(), pendingConnection.password.c_str());
  } else {
    WiFi.begin(pendingConnection.ssid.c_str());
  }

  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(pendingConnection.ssid);

  enterRuntimeMode(RuntimeMode::WifiConnecting);
  return true;
}

void beginSuccessWindow() {
  applyConnectedRadioTuning();
  startHttpServerIfNeeded();
  sPreviewServerReady = startPreviewServer();
  startMdnsServiceIfNeeded();
  syncClockIfNeeded();
  enterRuntimeMode(RuntimeMode::PostConnectValidation);
}

void transitionToConnectedIdle() {
  if (apActive) {
    stopAccessPoint();
  }

  startMdnsServiceIfNeeded();
  syncClockIfNeeded();
  enterRuntimeMode(RuntimeMode::ConnectedIdle);
}

void startHttpServerIfNeeded() {
  if (httpServerStarted) {
    return;
  }

  server.begin();
  httpServerStarted = true;
  Serial.println("HTTP server started");
}

bool loadCredentials(String& ssid, String& password) {
  ssid = preferences.getString(kSsidKey, "");
  password = preferences.getString(kPasswordKey, "");

  if (ssid.length() > 0) {
    savedSsidCache = ssid;
    savedPasswordCache = password;
    return true;
  }

  if (preferences.isKey(kLegacyPasswordKey)) {
    savedSsidCache = "";
    savedPasswordCache = preferences.getString(kLegacyPasswordKey, "");
    return false;
  }

  savedSsidCache = "";
  savedPasswordCache = "";
  return false;
}

void saveCredentials(const String& ssid, const String& password) {
  if (preferences.getString(kSsidKey, "") != ssid) preferences.putString(kSsidKey, ssid);
  if (preferences.getString(kPasswordKey, "") != password) preferences.putString(kPasswordKey, password);
  removePreferenceKeyIfPresent(kLegacyPasswordKey);
  savedSsidCache = ssid;
  savedPasswordCache = password;
}

void clearCredentials() {
  removePreferenceKeyIfPresent(kSsidKey);
  removePreferenceKeyIfPresent(kPasswordKey);
  removePreferenceKeyIfPresent(kLegacyPasswordKey);
  savedSsidCache = "";
  savedPasswordCache = "";
}

void loadConnectionError() {
  sLastErrorType = preferences.isKey(kErrorTypeKey)
    ? parseErrorType(preferences.getString(kErrorTypeKey, "none"))
    : ErrorType::None;
  sLastErrorMessage = preferences.isKey(kErrorMessageKey)
    ? preferences.getString(kErrorMessageKey, "")
    : "";
}

void persistConnectionError(ErrorType type, const String& message) {
  if (sLastErrorType == type && sLastErrorMessage == message) return;
  sLastErrorType = type;
  sLastErrorMessage = message;
  preferences.putString(kErrorTypeKey, errorTypeText(type));
  preferences.putString(kErrorMessageKey, message);
}

void clearConnectionError() {
  sLastErrorType = ErrorType::None;
  sLastErrorMessage = "";
  removePreferenceKeyIfPresent(kErrorTypeKey);
  removePreferenceKeyIfPresent(kErrorMessageKey);
}

void stopMdnsService() {
  if (mdnsActive) {
    MDNS.end();
    mdnsActive = false;
  }
}

void startMdnsServiceIfNeeded() {
  if (mdnsActive || WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (MDNS.begin(kMdnsHost)) {
    MDNS.addService("http", "tcp", 80);
    mdnsActive = true;
    Serial.println("mDNS started at http://esp32.local/");
  } else {
    Serial.println("mDNS start failed");
  }
}

bool indicatorPinUsable() {
  return !pinConflictsWithCamera(kIndicatorLedPin) && !pinConflictsWithSd1Bit(kIndicatorLedPin);
}

bool recordButtonPinUsable() {
  if (!kSdRecordingEnabled) return false;
  return !pinConflictsWithCamera(kRecordButtonPin) && !pinConflictsWithSd1Bit(kRecordButtonPin);
}

void syncClockIfNeeded() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (!timeSyncStarted) {
    configTime(kLocalUtcOffsetSeconds, 0, "time.nist.gov", "0.pool.ntp.org", "1.pool.ntp.org");
    timeSyncStarted = true;
  }

  timeSynced = isTimeKnown();
}

bool initStorage() {
  if (!kSdRecordingEnabled) {
    sdReady = false;
    return false;
  }
  if (mediaStatus().recording) return false;
  SD_MMC.end();
  sdReady = SD_MMC.begin("/sdcard", true);
  if (!sdReady) {
    Serial.println("SD_MMC mount failed");
    return false;
  }

  if (SD_MMC.cardType() == CARD_NONE) {
    Serial.println("No SD card detected");
    sdReady = false;
    SD_MMC.end();
    return false;
  }

  if (!ensureRecordingsRoot()) {
    Serial.println("Unable to create /recordings directory");
    sdReady = false;
    SD_MMC.end();
    return false;
  }

  Serial.println("SD_MMC ready in 1-bit mode");
  return true;
}

bool isTimeKnown() {
  return time(nullptr) >= kValidTimeThreshold;
}

String buildNextRecordingDirectory() {
  if (!sdReady || !ensureRecordingsRoot()) {
    return "";
  }

  if (isTimeKnown()) {
    return formatTimestampDirectory();
  }

  return buildNumericRecordingDirectory();
}

bool startRecordingSession() {
  if (recordingSession.active || !recordingCanStartNow()) {
    return false;
  }

  String directory = buildNextRecordingDirectory();
  if (directory.length() == 0) {
    persistConnectionError(ErrorType::Recording, "Unable to allocate a recording directory");
    return false;
  }

  if (!SD_MMC.mkdir(directory.c_str())) {
    persistConnectionError(ErrorType::Recording, "Unable to create the recording directory");
    return false;
  }

  if (!beginMediaRecording(directory)) {
    SD_MMC.rmdir(directory.c_str());
    persistConnectionError(ErrorType::Recording, "Recording worker is unavailable or still stopping");
    return false;
  }
  recordingSession.directory = directory;
  recordingSession.active = true;
  recordingSession.stopping = false;
  clearConnectionError();
  Serial.print("Recording started in ");
  Serial.println(directory);
  return true;
}

void stopRecordingSession(const String& reason) {
  if (!recordingSession.active || recordingSession.stopping) return;
  endMediaRecording();
  recordingSession.stopping = true;
  Serial.print("Finishing recording: ");
  Serial.println(reason);
}

String currentRecordingDirectory() {
  return recordingSession.directory;
}

bool scanNetworksAsync() {
  if (recordingSession.active || mediaStatus().previewClient) {
    scanState.error = "Stop recording and close the preview before scanning Wi-Fi";
    return false;
  }
  if (scanState.inProgress || (scanState.lastUpdatedAt != 0 && millis() - scanState.lastUpdatedAt < 10000)) {
    return true;
  }

  scanState.error = "";
  if (WiFi.getMode() == WIFI_OFF) {
    return false;
  }
  WiFi.scanDelete();

  int result = WiFi.scanNetworks(true, true);
  if (result == WIFI_SCAN_FAILED) {
    scanState.error = "Wi-Fi scan failed to start";
    scanState.jsonCache = "[]";
    scanState.inProgress = false;
    return false;
  }

  scanState.inProgress = true;
  return true;
}

void processWifiScan() {
  if (!scanState.inProgress) {
    return;
  }

  int result = WiFi.scanComplete();
  if (result == WIFI_SCAN_RUNNING) {
    return;
  }

  scanState.inProgress = false;
  scanState.lastUpdatedAt = millis();

  if (result == WIFI_SCAN_FAILED) {
    scanState.error = "Wi-Fi scan failed";
    scanState.jsonCache = "[]";
    WiFi.scanDelete();
    return;
  }

  String json = "[";
  json.reserve(2048);
  for (int i = 0; i < result && i < 20; ++i) {
    if (i > 0) {
      json += ",";
    }

    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) {
      ssid = "(hidden)";
    }

    json += "{\"ssid\":\"" + escapeJson(ssid) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]";

  scanState.error = "";
  scanState.jsonCache = json;
  WiFi.scanDelete();
}

bool streamAvailable() {
  return cameraReady && sPreviewServerReady &&
         (runtimeMode == RuntimeMode::ConnectedIdle || runtimeMode == RuntimeMode::PostConnectValidation) &&
         WiFi.status() == WL_CONNECTED;
}

void requestStreamStop() {
  setPreviewEnabled(false);
}

String buildStatusJson() {
  const MediaStatus media = mediaStatus();
  const ServoStatus servos = servoStatus();
  String json;
  json.reserve(4096);
  json = "{";
  json += "\"mode\":\"" + escapeJson(runtimeModeText()) + "\"";
  json += ",\"apActive\":";
  json += apActive ? "true" : "false";
  json += ",\"wifiConnected\":";
  json += (WiFi.status() == WL_CONNECTED) ? "true" : "false";
  json += ",\"wifiStatusCode\":";
  json += String(static_cast<int>(WiFi.status()));
  json += ",\"streamAvailable\":";
  json += streamAvailable() ? "true" : "false";
  json += ",\"recordingEnabled\":";
  json += kSdRecordingEnabled ? "true" : "false";
  json += ",\"servoReady\":";
  json += servos.ready ? "true" : "false";
  json += ",\"servoMqttConnected\":";
  json += servos.mqttConnected ? "true" : "false";
  json += ",\"servoX\":" + String(servos.x);
  json += ",\"servoY\":" + String(servos.y);
  json += ",\"servoTopic\":\"" + escapeJson(servoCommandTopic()) + "\"";
  json += ",\"servoError\":\"" + escapeJson(servos.error ? servos.error : "") + "\"";
  json += ",\"servoRejectedCommands\":" + String(servos.rejectedCommands);
  json += ",\"recordingActive\":";
  json += media.recording ? "true" : "false";
  json += ",\"recordingStopping\":";
  json += media.stopping ? "true" : "false";
  json += ",\"recordedFrames\":" + String(media.recordedFrames);
  json += ",\"droppedFrames\":" + String(media.recordingDropped);
  json += ",\"capturedFrames\":" + String(media.capturedFrames);
  json += ",\"previewFrames\":" + String(media.previewFrames);
  json += ",\"captureErrors\":" + String(media.captureErrors);
  json += ",\"oversizedFrames\":" + String(media.oversizedFrames);
  json += ",\"maxWriteMs\":" + String(media.maxWriteMs);
  json += ",\"freeHeap\":" + String(ESP.getFreeHeap());
  json += ",\"freePsram\":" + String(ESP.getFreePsram());
  json += ",\"targetFps\":20,\"width\":" + String(media.width);
  json += ",\"height\":" + String(media.height) + ",\"streamPort\":81";
  json += ",\"mediaError\":\"" + escapeJson(mediaErrorMessage(media.error)) + "\"";
  json += ",\"gyroMqttConnected\":";
  json += gyroMqttConnected() ? "true" : "false";
  json += ",\"gyroError\":\"" + escapeJson(gyroLastError()) + "\"";
  json += ",\"recordingDirectory\":\"" + escapeJson(currentRecordingDirectory()) + "\"";
  json += ",\"sdReady\":";
  json += sdReady ? "true" : "false";
  json += ",\"timeSynced\":";
  json += isTimeKnown() ? "true" : "false";
  json += ",\"gyroEnabled\":";
  json += isGyroToggleEnabled() ? "true" : "false";
  json += ",\"gyroAvailable\":";
  json += gyroHardwareAvailable() ? "true" : "false";
  json += ",\"gyroReady\":";
  json += gyroIsRunning() ? "true" : "false";
  json += ",\"lastErrorType\":\"" + escapeJson(errorTypeText(lastConnectionErrorType())) + "\"";
  json += ",\"lastErrorMessage\":\"" + escapeJson(lastConnectionErrorMessage()) + "\"";
  json += ",\"savedSsid\":\"" + escapeJson(savedSsidCache) + "\"";
  json += ",\"stationIp\":\"" + escapeJson(WiFi.localIP().toString()) + "\"";
  json += ",\"apIp\":\"" + escapeJson(kApIp.toString()) + "\"";
  json += ",\"scanInProgress\":";
  json += scanState.inProgress ? "true" : "false";
  json += ",\"scanError\":\"" + escapeJson(scanState.error) + "\"";
  json += ",\"networks\":";
  json += scanState.jsonCache;
  json += "}";
  return json;
}

void processRuntimeState() {
  processWifiScan();
  syncClockIfNeeded();
  updateRecordButtonState();

  switch (runtimeMode) {
    case RuntimeMode::WifiConnecting:
      if (WiFi.status() == WL_CONNECTED) {
        applyConnectedRadioTuning();
        startMdnsServiceIfNeeded();
        syncClockIfNeeded();
        prepareAndCommitConnection();
      } else if (millis() - runtimeModeStartedAt >= kWifiConnectTimeoutMs) {
        enterErrorFallback(ErrorType::WiFi, wifiFailureMessage(), pendingConnection.keepAccessPoint, RuntimeMode::SoftApConfig);
      }
      break;

    case RuntimeMode::PostConnectValidation:
      if (WiFi.status() != WL_CONNECTED) {
        enterErrorFallback(ErrorType::Disconnect, "Wi-Fi connection lost during validation", true, RuntimeMode::SoftApConfig);
      } else {
        gyroLoop();
        if (millis() - runtimeModeStartedAt >= kStatusHoldMs) {
          transitionToConnectedIdle();
        }
      }
      break;

    case RuntimeMode::ConnectedIdle:
      if (WiFi.status() != WL_CONNECTED) {
        enterErrorFallback(ErrorType::Disconnect, "Wi-Fi connection lost", true, RuntimeMode::SoftApConfig);
      } else {
        gyroLoop();
      }
      break;

    case RuntimeMode::ErrorFallback:
      if (millis() - runtimeModeStartedAt >= kErrorHoldMs) {
        if (sErrorReturnMode == RuntimeMode::SoftApConfig) {
          if (startApWhenErrorWindowEnds && !apActive) {
            startAccessPoint();
          }
          enterRuntimeMode(RuntimeMode::SoftApConfig);
        } else if (sErrorReturnMode == RuntimeMode::ConnectedIdle) {
          transitionToConnectedIdle();
        } else {
          enterRuntimeMode(sErrorReturnMode);
        }
      }
      break;

    case RuntimeMode::SoftApConfig:
      if (savedSsidCache.length() > 0 && millis() - sLastReconnectAttempt >= 30000) {
        PendingConnectionRequest retry;
        retry.ssid = savedSsidCache;
        retry.password = savedPasswordCache;
        retry.keepAccessPoint = true;
        retry.gyroEnabled = isGyroToggleEnabled();
        retry.validationRoute = getGyroValidationRoute();
        startConnectionAttempt(retry);
      }
      break;
  }

  const MediaStatus media = mediaStatus();
  if (recordingSession.active && !media.recording) {
    recordingSession.active = false;
    recordingSession.stopping = false;
    Serial.println("Recording closed; SD files can now be removed safely after power-off");
    if (media.error != MediaError::None) {
      persistConnectionError(ErrorType::Recording, mediaErrorMessage(media.error));
      if (media.error == MediaError::StorageWrite || media.error == MediaError::MetadataWrite) sdReady = false;
    }
  } else {
    recordingSession.stopping = media.stopping;
  }

  if (recordingSession.clickPending) {
    recordingSession.clickPending = false;
    if (recordingSession.active) {
      stopRecordingSession("Button clicked");
    } else if (!cameraReady) {
      persistConnectionError(ErrorType::Recording, "Camera unavailable for recording");
    } else if (!sdReady && !initStorage()) {
      persistConnectionError(ErrorType::SDCard, "SD card is not available for recording");
    } else if (recordingCanStartNow()) {
      startRecordingSession();
    }
  }

  setPreviewEnabled(streamAvailable());
  updateLedOutput();
}
