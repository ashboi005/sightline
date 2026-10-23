#include <Arduino.h>
#include <WiFi.h>
#include "servo_module.h"
#include "servo_command.h"
#include "mqtt_config.h"
#include <driver/ledc.h>
#include <esp_random.h>
#include <mqtt_client.h>
#include <atomic>

namespace {
constexpr int kServoXPin = 14;
constexpr int kServoYPin = 15;
constexpr int kCenterDegrees = 90;
constexpr uint32_t kServoFrequencyHz = 50;
// Calibrate these endpoints for the actual servo model and linkage.
constexpr uint32_t kServoMinPulseUs = 500;
constexpr uint32_t kServoMaxPulseUs = 2500;
constexpr uint32_t kServoPeriodUs = 1000000 / kServoFrequencyHz;
// Camera XCLK uses low-speed timer 0/channel 0; reserve a separate PWM bank.
constexpr ledc_mode_t kServoSpeedMode = LEDC_HIGH_SPEED_MODE;
constexpr ledc_timer_t kServoTimer = LEDC_TIMER_1;
constexpr ledc_channel_t kServoXChannel = LEDC_CHANNEL_2;
constexpr ledc_channel_t kServoYChannel = LEDC_CHANNEL_3;
static_assert(kServoMinPulseUs < kServoMaxPulseUs && kServoMaxPulseUs < kServoPeriodUs,
              "Servo pulse range must fit within a PWM period");

enum class ServoError { None, PwmInit, PwmWrite, MqttInit, MqttStart, MqttSubscribe };
std::atomic<ServoError> sError{ServoError::None};
std::atomic<bool> sMqttConnected{false};
std::atomic<bool> sRestartRequested{false};
std::atomic<uint32_t> sPositions{kCenterDegrees | (kCenterDegrees << 8)};
std::atomic<uint32_t> sRejectedCommands{0};
bool sInitialized = false;
bool sReady = false;
esp_mqtt_client_handle_t sClient = nullptr;
int sSubscriptionId = -1;  // Accessed only by the MQTT event task.
uint32_t sLastMqttAttemptAt = 0;
bool sMqttAttempted = false;
char sClientId[32] = {};

const char* errorMessage(ServoError error) {
  switch (error) {
    case ServoError::PwmInit: return "Unable to initialize servo PWM";
    case ServoError::PwmWrite: return "Unable to update servo PWM";
    case ServoError::MqttInit: return "Unable to allocate servo MQTT client";
    case ServoError::MqttStart: return "Unable to start servo MQTT client";
    case ServoError::MqttSubscribe: return "Unable to subscribe to servo commands";
    default: return "";
  }
}

uint32_t pulseDuty(int degrees) {
  const uint32_t pulseUs = kServoMinPulseUs +
      (kServoMaxPulseUs - kServoMinPulseUs) * degrees / 180;
  return ((static_cast<uint64_t>(pulseUs) << 16) + kServoPeriodUs / 2) / kServoPeriodUs;
}

bool initializePwm() {
  ledc_timer_config_t timer = {};
  timer.speed_mode = kServoSpeedMode;
  timer.timer_num = kServoTimer;
  timer.duty_resolution = LEDC_TIMER_16_BIT;
  timer.freq_hz = kServoFrequencyHz;
  timer.clk_cfg = LEDC_USE_APB_CLK;
  if (ledc_timer_config(&timer) != ESP_OK) return false;

  ledc_channel_config_t channel = {};
  channel.speed_mode = kServoSpeedMode;
  channel.timer_sel = kServoTimer;
  channel.duty = pulseDuty(kCenterDegrees);
  channel.channel = kServoXChannel;
  channel.gpio_num = kServoXPin;
  if (ledc_channel_config(&channel) != ESP_OK) return false;
  channel.channel = kServoYChannel;
  channel.gpio_num = kServoYPin;
  if (ledc_channel_config(&channel) != ESP_OK) {
    ledc_stop(kServoSpeedMode, kServoXChannel, 0);
    return false;
  }
  return true;
}

void initializeMqttClientId() {
  snprintf(sClientId, sizeof(sClientId), "servo-%08lx%08lx",
      static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  Serial.printf("Servo MQTT: %s:%u, command topic: %s\n",
      kPublicMqttBrokerHost, kPublicMqttBrokerPort, kServoCommandTopic);
}

bool moveAxis(ledc_channel_t channel, int32_t delta, int& position) {
  const int next = servo::applyDelta(position, delta);
  if (next == position) return true;
  if (ledc_set_duty(kServoSpeedMode, channel, pulseDuty(next)) != ESP_OK ||
      ledc_update_duty(kServoSpeedMode, channel) != ESP_OK) return false;
  position = next;
  return true;
}

void receiveCommand(esp_mqtt_event_handle_t event) {
  servo::Delta delta;
  if (!sMqttConnected.load()) {
    sRejectedCommands.fetch_add(1);
    Serial.printf("Servo MQTT message received but rejected (%d bytes): subscription not ready\n",
                  event->data_len);
    return;
  }
  if (!servo::acceptsMessage(kServoCommandTopic, event->topic, event->topic_len, event->data_len,
                            event->total_data_len, event->current_data_offset, event->retain)) {
    sRejectedCommands.fetch_add(1);
    Serial.printf("Servo MQTT message received but rejected (%d bytes): invalid topic, retained, fragmented or oversized\n",
                  event->data_len);
    return;
  }
  if (!servo::parseDelta(event->data, event->data_len, delta)) {
    sRejectedCommands.fetch_add(1);
    Serial.printf("Servo MQTT message received but rejected (%d bytes): invalid JSON command\n",
                  event->data_len);
    return;
  }
  const uint32_t positions = sPositions.load();
  int x = positions & 0xff;
  int y = (positions >> 8) & 0xff;
  // This MQTT event task is the sole PWM writer after startup.
  const bool xUpdated = moveAxis(kServoXChannel, delta.x, x);
  const bool yUpdated = moveAxis(kServoYChannel, delta.y, y);
  sPositions.store(static_cast<uint32_t>(x | (y << 8)));
  sError.store(xUpdated && yUpdated ? ServoError::None : ServoError::PwmWrite);
  if (xUpdated && yUpdated) {
    Serial.printf("Servo MQTT command received and applied: dx=%+ld dy=%+ld -> X=%d Y=%d\n",
                  static_cast<long>(delta.x), static_cast<long>(delta.y), x, y);
  } else {
    Serial.printf("Servo MQTT command received but PWM update failed: dx=%+ld dy=%+ld -> X=%d Y=%d\n",
                  static_cast<long>(delta.x), static_cast<long>(delta.y), x, y);
  }
}

esp_err_t mqttEvent(esp_mqtt_event_handle_t event) {
  switch (event->event_id) {
    case MQTT_EVENT_CONNECTED:
      sMqttConnected.store(false);
      sRestartRequested.store(false);
      sSubscriptionId = esp_mqtt_client_subscribe(event->client, kServoCommandTopic, 0);
      if (sSubscriptionId < 0) {
        sError.store(ServoError::MqttSubscribe);
        sRestartRequested.store(true);
      }
      break;
    case MQTT_EVENT_SUBSCRIBED:
      if (event->msg_id == sSubscriptionId) {
        // The SDK forwards SUBACK payloads, including the 0x80 refusal code.
        const bool accepted = event->data && event->data_len == 1 && event->data[0] == 0;
        sMqttConnected.store(accepted);
        sRestartRequested.store(!accepted);
        if (!accepted) sError.store(ServoError::MqttSubscribe);
        else {
          if (sError.load() == ServoError::MqttSubscribe) sError.store(ServoError::None);
          Serial.println("Servo MQTT command subscription ready");
        }
      }
      break;
    case MQTT_EVENT_DATA:
      receiveCommand(event);
      break;
    case MQTT_EVENT_DISCONNECTED:
    case MQTT_EVENT_ERROR:
      sMqttConnected.store(false);
      sSubscriptionId = -1;
      break;
    default: break;
  }
  return ESP_OK;
}
}  // namespace

bool servoBegin() {
  if (sInitialized) return sReady;
  sInitialized = true;
  initializeMqttClientId();
  sReady = initializePwm();
  if (!sReady) {
    sError.store(ServoError::PwmInit);
    Serial.println(errorMessage(sError.load()));
    return false;
  }
  Serial.println("Servos centered: X GPIO14 = 90 degrees, Y GPIO15 = 90 degrees");
  return true;
}

void servoLoop() {
  if (!sReady || WiFi.status() != WL_CONNECTED) return;
  if (sClient && !sRestartRequested.load()) return;
  const uint32_t now = millis();
  if (sMqttAttempted && now - sLastMqttAttemptAt < 5000) return;
  sMqttAttempted = true;
  sLastMqttAttemptAt = now;
  if (sClient) {
    // Stop/destroy are forbidden inside MQTT callbacks. Recover here with a
    // bounded retry interval, preserving PWM output and commanded positions.
    if (esp_mqtt_client_stop(sClient) != ESP_OK) return;
    esp_mqtt_client_destroy(sClient);
    sClient = nullptr;
  }
  sRestartRequested.store(false);
  esp_mqtt_client_config_t config = {};
  config.host = kPublicMqttBrokerHost;
  config.port = kPublicMqttBrokerPort;
  config.client_id = sClientId;
  config.event_handle = mqttEvent;
  config.task_stack = 4096;
  config.task_prio = 1;
  config.buffer_size = 512;  // Entire supported topic + command fits in one event.
  config.network_timeout_ms = 2000;
  config.reconnect_timeout_ms = 5000;
  config.keepalive = 30;
  // Default clean session + QoS 0 avoid queuing relative movements while offline.
  sClient = esp_mqtt_client_init(&config);
  if (!sClient) { sError.store(ServoError::MqttInit); return; }
  sError.store(ServoError::None);
  if (esp_mqtt_client_start(sClient) != ESP_OK) {
    esp_mqtt_client_destroy(sClient);
    sClient = nullptr;
    sError.store(ServoError::MqttStart);
  }
  // ESP-MQTT handles reconnects in its own task; it never resets the angles.
}

ServoStatus servoStatus() {
  const uint32_t positions = sPositions.load();
  return {sReady, sMqttConnected.load() && WiFi.status() == WL_CONNECTED,
          static_cast<int>(positions & 0xff), static_cast<int>((positions >> 8) & 0xff),
          sRejectedCommands.load(), errorMessage(sError.load())};
}

const char* servoCommandTopic() { return kServoCommandTopic; }
