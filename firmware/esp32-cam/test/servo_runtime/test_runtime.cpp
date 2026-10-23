#include "servo_module.h"
#include "test_platform.h"

#include <array>
#include <cstring>
#include <vector>

namespace {
int failures = 0;
uint32_t now = 100;
std::vector<ledc_timer_config_t> timers;
std::vector<ledc_channel_config_t> channels;
std::array<uint32_t, 4> pendingDuty{};
std::array<uint32_t, 4> duty{};
int dutyUpdates = 0;
int initCalls = 0;
int startCalls = 0;
int stopCalls = 0;
int destroyCalls = 0;
int subscribeCalls = 0;
int nextSubscriptionId = 41;
int lastSubscriptionId = -1;
bool subscribeFails = false;
bool inCallback = false;
esp_mqtt_client clients[8]{};
esp_mqtt_client_handle_t activeClient = nullptr;
esp_mqtt_client_config_t mqttConfig{};
String subscribedTopic;
int subscribedQos = -1;

void expect(bool condition, const char* description) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", description);
    ++failures;
  }
}

void event(esp_mqtt_event_id_t kind, int id = 0, const char* data = nullptr,
           int length = 0, bool retained = false) {
  esp_mqtt_event_t message{};
  message.event_id = kind;
  message.client = activeClient;
  message.msg_id = id;
  message.data = const_cast<char*>(data);
  message.data_len = length;
  message.total_data_len = length;
  message.topic = const_cast<char*>(servoCommandTopic());
  message.topic_len = static_cast<int>(std::strlen(message.topic));
  message.retain = retained;
  expect(mqttConfig.event_handle != nullptr, "MQTT config registers the production callback");
  if (!mqttConfig.event_handle) return;
  inCallback = true;
  mqttConfig.event_handle(&message);
  inCallback = false;
}

void acknowledge() {
  const char granted = 0;
  event(MQTT_EVENT_SUBSCRIBED, lastSubscriptionId, &granted, 1);
}

void command(const char* text, bool retained = false) {
  event(MQTT_EVENT_DATA, 0, text, static_cast<int>(std::strlen(text)), retained);
}

void expectPositions(int x, int y, const char* description) {
  const ServoStatus status = servoStatus();
  expect(status.x == x && status.y == y, description);
}

// A failed subscribe must cause a retry only after the bounded delay.
// This checks real production calls at the MQTT boundary, with no test reset hook.
void expectRetryAfterFiveSeconds() {
  const int previousInit = initCalls;
  const int previousStart = startCalls;
  const int previousStop = stopCalls;
  const int previousDestroy = destroyCalls;
  const int previousWrites = dutyUpdates;
  now += 4999;
  servoLoop();
  expect(initCalls == previousInit && stopCalls == previousStop,
         "subscription retry does not spin before five seconds");
  ++now;
  servoLoop();
  expect(stopCalls == previousStop + 1 && destroyCalls == previousDestroy + 1,
         "subscription failure stops and destroys the client in the main loop");
  expect(initCalls == previousInit + 1 && startCalls == previousStart + 1,
         "subscription failure restarts MQTT after five seconds");
  expect(dutyUpdates == previousWrites,
         "restarting MQTT does not rewrite servo PWM");
  expectPositions(175, 0, "restarting MQTT holds both current angles");
}
}  // namespace

SerialStub Serial;
WiFiStub WiFi;

uint32_t millis() { return now; }
uint32_t esp_random() { return 0x12345678; }

esp_err_t ledc_timer_config(const ledc_timer_config_t* config) {
  timers.push_back(*config);
  return ESP_OK;
}
esp_err_t ledc_channel_config(const ledc_channel_config_t* config) {
  channels.push_back(*config);
  duty[config->channel] = config->duty;
  return ESP_OK;
}
esp_err_t ledc_stop(ledc_mode_t, ledc_channel_t, uint32_t) { return ESP_OK; }
esp_err_t ledc_set_duty(ledc_mode_t, ledc_channel_t channel, uint32_t value) {
  pendingDuty[channel] = value;
  return ESP_OK;
}
esp_err_t ledc_update_duty(ledc_mode_t, ledc_channel_t channel) {
  duty[channel] = pendingDuty[channel];
  ++dutyUpdates;
  return ESP_OK;
}
esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t* config) {
  mqttConfig = *config;
  activeClient = &clients[initCalls % 8];
  activeClient->number = ++initCalls;
  return activeClient;
}
esp_err_t esp_mqtt_client_start(esp_mqtt_client_handle_t) {
  ++startCalls;
  return ESP_OK;
}
esp_err_t esp_mqtt_client_stop(esp_mqtt_client_handle_t) {
  expect(!inCallback, "client stop never runs inside the MQTT callback");
  ++stopCalls;
  return ESP_OK;
}
esp_err_t esp_mqtt_client_destroy(esp_mqtt_client_handle_t) {
  expect(!inCallback, "client destroy never runs inside the MQTT callback");
  ++destroyCalls;
  return ESP_OK;
}
int esp_mqtt_client_subscribe(esp_mqtt_client_handle_t, const char* topic, int qos) {
  ++subscribeCalls;
  subscribedTopic = topic;
  subscribedQos = qos;
  lastSubscriptionId = subscribeFails ? -1 : nextSubscriptionId++;
  return lastSubscriptionId;
}

int main() {
  expect(servoBegin(), "PWM starts successfully before Wi-Fi connects");
  expectPositions(90, 90, "startup centers both axes");
  expect(channels.size() == 2 && channels[0].gpio_num == 14 && channels[1].gpio_num == 15,
         "both requested GPIO pins receive PWM configuration");
  expect(duty[LEDC_CHANNEL_2] == 4915 && duty[LEDC_CHANNEL_3] == 4915,
         "startup drives the 1500 us center pulse on both channels");
  expect(timers.size() == 1 && timers[0].speed_mode == LEDC_HIGH_SPEED_MODE &&
         timers[0].freq_hz == 50 && timers[0].duty_resolution == LEDC_TIMER_16_BIT,
         "servo pulses use a camera-independent 50 Hz PWM timer");
  servoLoop();
  expect(initCalls == 0, "offline startup does not start MQTT");
  expect(servoBegin() && channels.size() == 2, "repeated begin does not recenter hardware");

  WiFi.connection = WL_CONNECTED;
  servoLoop();
  expect(initCalls == 1 && startCalls == 1, "Wi-Fi connection starts the servo MQTT client");
  expect(std::strcmp(mqttConfig.host, "broker.hivemq.com") == 0 && mqttConfig.port == 1883,
         "servo MQTT connects to the public HiveMQ endpoint");
  event(MQTT_EVENT_CONNECTED);
  expect(!servoStatus().mqttConnected, "connection waits for subscription acknowledgement");
  expect(subscribedTopic == "esp32cam/kate/servo/delta" &&
         subscribedQos == 0, "subscription uses the fixed command topic with QoS zero");
  const char granted = 0;
  event(MQTT_EVENT_SUBSCRIBED, lastSubscriptionId + 100, &granted, 1);
  expect(!servoStatus().mqttConnected, "unrelated subscription acknowledgement is ignored");
  acknowledge();
  expect(servoStatus().mqttConnected, "successful subscription enables servo commands");

  command("{\"x\":5,\"y\":-3}");
  expectPositions(95, 87, "signed commands update both current angles");
  expect(duty[LEDC_CHANNEL_2] == 5095 && duty[LEDC_CHANNEL_3] == 4804,
         "signed commands reach the hardware PWM boundary");
  const int writesAfterMove = dutyUpdates;
  const uint32_t rejectedBefore = servoStatus().rejectedCommands;
  command("{\"x\":1,\"y\":\"bad\"}");
  command("{\"x\":1}", true);
  expectPositions(95, 87, "malformed and retained commands preserve both axes");
  expect(dutyUpdates == writesAfterMove, "rejected commands never change PWM");
  expect(servoStatus().rejectedCommands == rejectedBefore + 2,
         "rejected commands are visible in status");
  command("{\"x\":2147483647,\"y\":-2147483648}");
  expectPositions(180, 0, "large deltas clamp without overflowing");
  expect(duty[LEDC_CHANNEL_2] == 8192 && duty[LEDC_CHANNEL_3] == 1638,
         "clamped angles produce endpoint pulses");
  command("{\"x\":-5}");
  expectPositions(175, 0, "single-axis command preserves the other axis");
  expect(duty[LEDC_CHANNEL_2] == 8008 && duty[LEDC_CHANNEL_3] == 1638,
         "movement reverses from a clamped endpoint");

  const int writesBeforeReconnect = dutyUpdates;
  const int subscriptionsBeforeReconnect = subscribeCalls;
  event(MQTT_EVENT_DISCONNECTED);
  WiFi.connection = WL_DISCONNECTED;
  expect(!servoStatus().mqttConnected, "disconnect clears MQTT readiness");
  servoLoop();
  WiFi.connection = WL_CONNECTED;
  event(MQTT_EVENT_CONNECTED);
  acknowledge();
  expect(subscribeCalls == subscriptionsBeforeReconnect + 1 && servoStatus().mqttConnected,
         "reconnection subscribes again before accepting commands");
  expectPositions(175, 0, "disconnect and reconnect preserve current angles");
  expect(dutyUpdates == writesBeforeReconnect, "reconnection never recenters PWM");

  const char refused = static_cast<char>(0x80);
  event(MQTT_EVENT_DISCONNECTED);
  event(MQTT_EVENT_CONNECTED);
  event(MQTT_EVENT_SUBSCRIBED, lastSubscriptionId, &refused, 1);
  expect(!servoStatus().mqttConnected, "SUBACK 0x80 is rejected instead of marking MQTT ready");
  const char qosOne = 1;
  const char multipleCodes[] = {0, 0};
  struct InvalidAcknowledgement {
    const char* data;
    int length;
    const char* description;
  };
  const InvalidAcknowledgement invalidAcknowledgements[] = {
    {&qosOne, 1, "unexpected granted QoS does not mark MQTT ready"},
    {nullptr, 1, "missing SUBACK data does not mark MQTT ready"},
    {&granted, 0, "empty SUBACK does not mark MQTT ready"},
    {multipleCodes, 2, "multiple SUBACK results do not mark MQTT ready"}
  };
  for (const auto& invalid : invalidAcknowledgements) {
    event(MQTT_EVENT_DISCONNECTED);
    event(MQTT_EVENT_CONNECTED);
    event(MQTT_EVENT_SUBSCRIBED, lastSubscriptionId, invalid.data, invalid.length);
    expect(!servoStatus().mqttConnected, invalid.description);
  }
  expectRetryAfterFiveSeconds();
  event(MQTT_EVENT_CONNECTED);
  acknowledge();
  expect(servoStatus().mqttConnected, "subscription succeeds after a refused SUBACK retry");

  event(MQTT_EVENT_DISCONNECTED);
  subscribeFails = true;
  event(MQTT_EVENT_CONNECTED);
  expect(!servoStatus().mqttConnected, "subscribe enqueue failure leaves MQTT unready");
  expectRetryAfterFiveSeconds();
  subscribeFails = false;
  event(MQTT_EVENT_CONNECTED);
  acknowledge();
  expect(servoStatus().mqttConnected, "subscription succeeds after an enqueue failure retry");
  expectPositions(175, 0, "all subscription recovery paths preserve positions");

  if (failures) return 1;
  std::puts("Servo runtime tests passed: startup PWM, commands, filtering, reconnect, subscription recovery.");
  return 0;
}
