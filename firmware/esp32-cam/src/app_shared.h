#pragma once

#include <Arduino.h>
#include "esp_camera.h"
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <FS.h>
#include <Preferences.h>
#include <SD_MMC.h>
#include <WebServer.h>
#include <WiFi.h>

#define CAMERA_MODEL_AI_THINKER
#include "camera_pins.h"

enum class RuntimeMode : uint8_t {
  SoftApConfig,
  WifiConnecting,
  PostConnectValidation,
  ConnectedIdle,
  ErrorFallback
};

enum class ErrorType : uint8_t {
  None,
  WiFi,
  Gyro,
  Disconnect,
  SDCard,
  Recording
};

struct PendingConnectionRequest {
  bool active = false;
  bool keepAccessPoint = false;
  String ssid;
  String password;
  bool gyroEnabled = false;
  String validationRoute;
  String email;
  String authPassword;
};

struct RecordingSession {
  bool active = false;
  bool stablePressed = false;
  bool lastPhysicalPressed = false;
  bool clickPending = false;
  bool stopping = false;
  unsigned long lastDebounceAt = 0;
  String directory;
};

struct ScanState {
  bool inProgress = false;
  String jsonCache = "[]";
  String error;
  unsigned long lastUpdatedAt = 0;
};

enum class MediaError : uint8_t {
  None,
  CameraCapture,
  StorageWrite,
  MetadataWrite
};

// Snapshots are copied under the media mutex; callers never touch worker state.
struct MediaStatus {
  bool recording = false;
  bool stopping = false;
  bool previewClient = false;
  uint32_t capturedFrames = 0;
  uint32_t recordedFrames = 0;
  uint32_t recordingDropped = 0;
  uint32_t previewFrames = 0;
  uint32_t captureErrors = 0;
  uint32_t oversizedFrames = 0;
  uint32_t maxWriteMs = 0;
  uint16_t width = 0;
  uint16_t height = 0;
  MediaError error = MediaError::None;
};

// GPIO14/GPIO15 are reserved for X/Y servos; never initialize SD recording.
constexpr bool kSdRecordingEnabled = false;

// The SDK allocates JPEG buffers by a preset's pixel count / 5. XGA reserves
// about 154 KiB per buffer for detailed portrait JPEGs; output is set separately.
constexpr framesize_t kCameraBufferFrameSize = FRAMESIZE_XGA;
constexpr uint16_t kCameraPortraitWidth = 600;
constexpr uint16_t kCameraPortraitHeight = 800;

extern const char kAccessPointSsid[];
extern const char kAccessPointPassword[];
extern const char kMdnsHost[];
extern const uint16_t kDnsPort;
extern const unsigned long kWifiConnectTimeoutMs;
extern const unsigned long kStatusHoldMs;
extern const unsigned long kErrorHoldMs;
extern const unsigned long kFastBlinkIntervalMs;
extern const unsigned long kSlowBlinkIntervalMs;
extern const unsigned long kRecordingFrameIntervalMs;
extern const unsigned long kButtonDebounceMs;
extern const uint8_t kIndicatorLedPin;
extern const uint8_t kRecordButtonPin;

extern const IPAddress kApIp;
extern const IPAddress kApSubnet;

class AppWebServer : public WebServer {
 public:
  using WebServer::WebServer;
  void parseBoundedForm(const String& body) { _parseArguments(body); }
  void markRawBodyConsumed() { _clientContentLength = 0; }
};

extern AppWebServer server;
extern DNSServer dnsServer;
extern Preferences preferences;

extern bool cameraReady;
extern bool apActive;
extern bool mdnsActive;
extern bool httpServerStarted;
extern bool sdReady;
extern bool timeSyncStarted;
extern bool timeSynced;

extern RuntimeMode runtimeMode;
extern PendingConnectionRequest pendingConnection;
extern RecordingSession recordingSession;
extern ScanState scanState;
extern unsigned long runtimeModeStartedAt;
extern bool startApWhenErrorWindowEnds;
extern String savedSsidCache;
extern String savedPasswordCache;

String escapeJson(const String& input);
String escapeHtml(const String& input);
String runtimeModeText();
String errorTypeText(ErrorType type);
ErrorType lastConnectionErrorType();
String lastConnectionErrorMessage();

bool initCamera();
void handleStream();
bool startPreviewServer();
void setPreviewEnabled(bool enabled);
bool beginMediaRecording(const String& directory);
void endMediaRecording();
MediaStatus mediaStatus();
const char* mediaErrorMessage(MediaError error);
bool indicatorPinUsable();
bool recordButtonPinUsable();

bool startAccessPoint();
void stopAccessPoint();
void startConfigMode();
void enterErrorFallback(ErrorType type, const String& message, bool startApNow, RuntimeMode returnMode = RuntimeMode::SoftApConfig);
bool startConnectionAttempt(const PendingConnectionRequest& request);
void beginSuccessWindow();
void transitionToConnectedIdle();
void processRuntimeState();
void startHttpServerIfNeeded();

bool streamAvailable();
void requestStreamStop();
String buildStatusJson();

bool initStorage();
bool isTimeKnown();
String buildNextRecordingDirectory();
bool startRecordingSession();
void stopRecordingSession(const String& reason = "");
String currentRecordingDirectory();

bool scanNetworksAsync();
void processWifiScan();

bool loadCredentials(String& ssid, String& password);
void saveCredentials(const String& ssid, const String& password);
void clearCredentials();

void loadConnectionError();
void persistConnectionError(ErrorType type, const String& message);
void clearConnectionError();

void startMdnsServiceIfNeeded();
void stopMdnsService();
void syncClockIfNeeded();

void registerRoutes();

void loadGyroSettings();
bool isGyroToggleEnabled();
const String& getGyroValidationRoute();
const String& getGyroIdentityUuid();
void setGyroRuntimeSettings(bool enabled, const String& validationRoute, const String& identityUuid);
void saveGyroSettings(bool enabled, const String& validationRoute, const String& identityUuid);
bool prepareGyroConfiguration(
  bool requestedEnable,
  const String& validationRoute,
  const String& email,
  const String& password,
  bool& enabledOut,
  String& routeOut,
  String& uuidOut,
  String& messageOut,
  bool& uuidUpdated
);

bool gyroHardwareAvailable();
void gyroStop();
bool gyroBeginIfEligible();
bool gyroValidateRuntime(String& messageOut);
bool gyroIsRunning();
bool gyroMqttConnected();
const char* gyroLastError();
void gyroLoop();
