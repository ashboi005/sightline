#include "app_shared.h"
#include "mqtt_config.h"
#include <mqtt_client.h>
#include <esp_random.h>
#include <atomic>
#include <Wire.h>

namespace {
constexpr uint8_t kMpuAddress = 0x68;
constexpr uint8_t kRegPowerMgmt1 = 0x6B;
constexpr uint8_t kRegAccelXoutH = 0x3B;
constexpr uint8_t kRegWhoAmI = 0x75;
constexpr uint8_t kRegGyroConfig = 0x1B;
constexpr uint8_t kRegAccelConfig = 0x1C;

// Optional gyro wiring remains separate from the GPIO14/GPIO15 servos.
constexpr int kGyroSdaPin = 3;
constexpr int kGyroSclPin = 13;

constexpr float kGyroScale = 131.0f;
constexpr float kComplementaryAlpha = 0.98f;

esp_mqtt_client_handle_t sMqttClient = nullptr;
std::atomic<bool> sMqttConnected{false};
String sLastError;
uint32_t sLastProbeAt = 0;
uint32_t sLastInitAttempt = 0;
bool sInitAttempted = false;

bool sImuReady = false;
bool sGyroRunning = false;
bool sGyroHardwareProbed = false;
bool sGyroHardwareDetected = false;

float sGyroXOffset = 0.0f;
float sGyroYOffset = 0.0f;
float sGyroZOffset = 0.0f;

float sYaw = 0.0f;
float sPitch = 0.0f;
float sRoll = 0.0f;

unsigned long sLastSampleMicros = 0;
unsigned long sLastPublishMs = 0;

String sMqttTopic;
String sMqttClientId;

bool writeMpuRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(kMpuAddress);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readMpuRegisters(uint8_t reg, uint8_t* data, size_t len) {
  Wire.beginTransmission(kMpuAddress);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  size_t received = Wire.requestFrom(static_cast<uint8_t>(kMpuAddress), len, true);
  if (received != len) {
    return false;
  }

  for (size_t i = 0; i < len; ++i) {
    data[i] = Wire.read();
  }

  return true;
}

bool readMpuRaw(
  int16_t& ax,
  int16_t& ay,
  int16_t& az,
  int16_t& gx,
  int16_t& gy,
  int16_t& gz
) {
  uint8_t bytes[14];
  if (!readMpuRegisters(kRegAccelXoutH, bytes, sizeof(bytes))) {
    return false;
  }

  ax = static_cast<int16_t>((bytes[0] << 8) | bytes[1]);
  ay = static_cast<int16_t>((bytes[2] << 8) | bytes[3]);
  az = static_cast<int16_t>((bytes[4] << 8) | bytes[5]);
  gx = static_cast<int16_t>((bytes[8] << 8) | bytes[9]);
  gy = static_cast<int16_t>((bytes[10] << 8) | bytes[11]);
  gz = static_cast<int16_t>((bytes[12] << 8) | bytes[13]);

  return true;
}

bool calibrateGyroOffsets() {
  long xSum = 0;
  long ySum = 0;
  long zSum = 0;
  const int sampleCount = 200;

  for (int i = 0; i < sampleCount; ++i) {
    int16_t ax = 0;
    int16_t ay = 0;
    int16_t az = 0;
    int16_t gx = 0;
    int16_t gy = 0;
    int16_t gz = 0;

    if (!readMpuRaw(ax, ay, az, gx, gy, gz)) {
      return false;
    }

    xSum += gx;
    ySum += gy;
    zSum += gz;
    delay(3);
  }

  sGyroXOffset = static_cast<float>(xSum) / static_cast<float>(sampleCount);
  sGyroYOffset = static_cast<float>(ySum) / static_cast<float>(sampleCount);
  sGyroZOffset = static_cast<float>(zSum) / static_cast<float>(sampleCount);
  return true;
}

bool initMpu(String& errorOut) {
  Wire.begin(kGyroSdaPin, kGyroSclPin);
  Wire.setClock(400000UL);
  Wire.setTimeOut(20);

  uint8_t whoAmI = 0;
  if (!readMpuRegisters(kRegWhoAmI, &whoAmI, 1)) {
    errorOut = "Gyro WHO_AM_I read failed on GPIO3/GPIO13";
    return false;
  }

  if ((whoAmI & 0x7E) != 0x68) {
    errorOut = "Unexpected MPU6050 WHO_AM_I value";
    return false;
  }

  sGyroHardwareProbed = true;
  sGyroHardwareDetected = true;

  if (!writeMpuRegister(kRegPowerMgmt1, 0x00)) {
    errorOut = "Unable to wake the MPU6050";
    return false;
  }

  delay(100);
  if (!writeMpuRegister(kRegGyroConfig, 0x00) || !writeMpuRegister(kRegAccelConfig, 0x00)) {
    errorOut = "Unable to configure MPU6050 ranges";
    return false;
  }

  if (!calibrateGyroOffsets()) {
    errorOut = "Gyro calibration failed";
    return false;
  }

  sYaw = 0.0f;
  sPitch = 0.0f;
  sRoll = 0.0f;
  sLastSampleMicros = micros();

  Serial.print("Gyro ready on SDA=");
  Serial.print(kGyroSdaPin);
  Serial.print(" SCL=");
  Serial.println(kGyroSclPin);
  errorOut = "";
  return true;
}

esp_err_t mqttEvent(esp_mqtt_event_handle_t event) {
  if (event->event_id == MQTT_EVENT_CONNECTED) sMqttConnected.store(true);
  if (event->event_id == MQTT_EVENT_DISCONNECTED || event->event_id == MQTT_EVENT_ERROR) {
    sMqttConnected.store(false);
  }
  return ESP_OK;
}

bool ensureMqttClient() {
  if (sMqttClient) return true;
  sMqttTopic = "eyetracker/" + getGyroIdentityUuid() + "/gyro";
  char identity[32];
  // Keep a unique ID for this client lifetime without exposing hardware identity.
  snprintf(identity, sizeof(identity), "espcam-%08lx%08lx",
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  sMqttClientId = identity;
  esp_mqtt_client_config_t config = {};
  config.host = kPublicMqttBrokerHost;
  config.port = kPublicMqttBrokerPort;
  config.client_id = sMqttClientId.c_str();
  config.event_handle = mqttEvent;
  config.task_stack = 4096;
  config.task_prio = 1;
  config.buffer_size = 512;
  config.network_timeout_ms = 2000;
  config.reconnect_timeout_ms = 5000;
  config.keepalive = 30;
  sMqttClient = esp_mqtt_client_init(&config);
  if (!sMqttClient) return false;
  if (esp_mqtt_client_start(sMqttClient) != ESP_OK) {
    esp_mqtt_client_destroy(sMqttClient);
    sMqttClient = nullptr;
    return false;
  }
  return true;
}

bool updateOrientation() {
  int16_t ax = 0;
  int16_t ay = 0;
  int16_t az = 0;
  int16_t gx = 0;
  int16_t gy = 0;
  int16_t gz = 0;

  if (!readMpuRaw(ax, ay, az, gx, gy, gz)) {
    return false;
  }

  unsigned long nowMicros = micros();
  float dt = static_cast<float>(nowMicros - sLastSampleMicros) / 1000000.0f;
  sLastSampleMicros = nowMicros;

  if (dt <= 0.0f || dt > 1.0f) {
    return false;
  }

  float gxRate = (static_cast<float>(gx) - sGyroXOffset) / kGyroScale;
  float gyRate = (static_cast<float>(gy) - sGyroYOffset) / kGyroScale;
  float gzRate = (static_cast<float>(gz) - sGyroZOffset) / kGyroScale;

  float axf = static_cast<float>(ax);
  float ayf = static_cast<float>(ay);
  float azf = static_cast<float>(az);

  float accelPitch = atan2f(ayf, sqrtf(axf * axf + azf * azf)) * 180.0f / PI;
  float accelRoll = atan2f(-axf, azf) * 180.0f / PI;

  sPitch = kComplementaryAlpha * (sPitch + gxRate * dt) + (1.0f - kComplementaryAlpha) * accelPitch;
  sRoll = kComplementaryAlpha * (sRoll + gyRate * dt) + (1.0f - kComplementaryAlpha) * accelRoll;
  sYaw = fmodf(sYaw + gzRate * dt, 360.0f);

  return true;
}
}  // namespace

bool gyroHardwareAvailable() {
  if (sImuReady || (sGyroHardwareProbed && millis() - sLastProbeAt < 5000)) {
    return sGyroHardwareDetected;
  }

  Wire.begin(kGyroSdaPin, kGyroSclPin);
  Wire.setClock(400000UL);
  Wire.setTimeOut(20);

  uint8_t whoAmI = 0;
  sLastProbeAt = millis();
  sGyroHardwareDetected = readMpuRegisters(kRegWhoAmI, &whoAmI, 1) && ((whoAmI & 0x7E) == 0x68);
  sGyroHardwareProbed = true;
  return sGyroHardwareDetected;
}

bool gyroValidateRuntime(String& messageOut) {
  messageOut = "";

  if (!isGyroToggleEnabled()) {
    gyroStop();
    return true;
  }

  if (getGyroIdentityUuid().length() == 0) {
    gyroStop();
    messageOut = "Gyro UUID is missing";
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    gyroStop();
    messageOut = "Wi-Fi is not connected";
    return false;
  }

  if (!gyroHardwareAvailable()) {
    gyroStop();
    messageOut = "Gyro hardware is not available on GPIO3/GPIO13";
    return false;
  }

  if (!sImuReady) {
    if (!initMpu(messageOut)) {
      gyroStop();
      return false;
    }
    sImuReady = true;
  }

  if (!ensureMqttClient()) {
    messageOut = "Unable to allocate MQTT client";
    return false;
  }
  sLastSampleMicros = micros();
  sGyroRunning = true;
  return true;
}

bool gyroBeginIfEligible() {
  sInitAttempted = true;
  sLastInitAttempt = millis();
  return gyroValidateRuntime(sLastError);
}

void gyroStop() {
  if (sMqttClient) {
    esp_mqtt_client_stop(sMqttClient);
    esp_mqtt_client_destroy(sMqttClient);
    sMqttClient = nullptr;
  }
  sMqttConnected.store(false);
  sGyroRunning = false;
}

bool gyroIsRunning() { return sGyroRunning; }
bool gyroMqttConnected() { return sMqttConnected.load(); }
const char* gyroLastError() { return sLastError.c_str(); }

void gyroLoop() {
  if (!isGyroToggleEnabled() || getGyroIdentityUuid().length() == 0 || WiFi.status() != WL_CONNECTED) {
    gyroStop();
    return;
  }
  const uint32_t now = millis();
  if (!sGyroRunning) {
    if (sInitAttempted && now - sLastInitAttempt < 5000) return;
    gyroBeginIfEligible();
    if (!sGyroRunning) return;
  }
  if (now - sLastPublishMs < 50) return;
  sLastPublishMs = now;
  if (!updateOrientation()) {
    sLastError = "MPU6050 read failed; retrying initialization";
    sImuReady = false;
    sGyroHardwareProbed = false;
    gyroStop();
    return;
  }
  sLastError = "";
  // QoS 0 data is disposable. Bound the queue and discard stale samples during outages.
  if (sMqttConnected.load() && esp_mqtt_client_get_outbox_size(sMqttClient) < 512) {
    char payload[64];
    snprintf(payload, sizeof(payload), "%.1f,%.1f,%.1f", sYaw, sPitch, sRoll);
    esp_mqtt_client_enqueue(sMqttClient, sMqttTopic.c_str(), payload, 0, 0, 0, true);
  }
}
