#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>

using String = std::string;
using esp_err_t = int;
constexpr esp_err_t ESP_OK = 0;
constexpr esp_err_t ESP_FAIL = -1;

struct SerialStub {
  void println(const char*) {}
  template <typename... Args> void printf(const char*, Args...) {}
};
extern SerialStub Serial;
uint32_t millis();
uint32_t esp_random();

constexpr int WL_DISCONNECTED = 6;
constexpr int WL_CONNECTED = 3;
struct WiFiStub {
  int connection = WL_DISCONNECTED;
  int status() const { return connection; }
};
extern WiFiStub WiFi;

enum ledc_mode_t { LEDC_HIGH_SPEED_MODE, LEDC_LOW_SPEED_MODE };
enum ledc_timer_t { LEDC_TIMER_0, LEDC_TIMER_1 };
enum ledc_channel_t { LEDC_CHANNEL_0, LEDC_CHANNEL_1, LEDC_CHANNEL_2, LEDC_CHANNEL_3 };
enum ledc_timer_bit_t { LEDC_TIMER_16_BIT = 16 };
enum ledc_clk_cfg_t { LEDC_USE_APB_CLK };
struct ledc_timer_config_t {
  ledc_mode_t speed_mode;
  ledc_timer_bit_t duty_resolution;
  ledc_timer_t timer_num;
  uint32_t freq_hz;
  ledc_clk_cfg_t clk_cfg;
};
struct ledc_channel_config_t {
  int gpio_num;
  ledc_mode_t speed_mode;
  ledc_channel_t channel;
  int intr_type;
  ledc_timer_t timer_sel;
  uint32_t duty;
  int hpoint;
};
esp_err_t ledc_timer_config(const ledc_timer_config_t* config);
esp_err_t ledc_channel_config(const ledc_channel_config_t* config);
esp_err_t ledc_stop(ledc_mode_t mode, ledc_channel_t channel, uint32_t idle);
esp_err_t ledc_set_duty(ledc_mode_t mode, ledc_channel_t channel, uint32_t duty);
esp_err_t ledc_update_duty(ledc_mode_t mode, ledc_channel_t channel);

struct esp_mqtt_client { int number; };
using esp_mqtt_client_handle_t = esp_mqtt_client*;
enum esp_mqtt_event_id_t {
  MQTT_EVENT_ERROR, MQTT_EVENT_CONNECTED, MQTT_EVENT_DISCONNECTED,
  MQTT_EVENT_SUBSCRIBED, MQTT_EVENT_UNSUBSCRIBED, MQTT_EVENT_PUBLISHED,
  MQTT_EVENT_DATA, MQTT_EVENT_BEFORE_CONNECT, MQTT_EVENT_DELETED
};
struct esp_mqtt_event_t {
  esp_mqtt_event_id_t event_id;
  esp_mqtt_client_handle_t client;
  void* user_context;
  char* data;
  int data_len;
  int total_data_len;
  int current_data_offset;
  char* topic;
  int topic_len;
  int msg_id;
  int session_present;
  void* error_handle;
  bool retain;
  int qos;
  bool dup;
};
using esp_mqtt_event_handle_t = esp_mqtt_event_t*;
struct esp_mqtt_client_config_t {
  const char* host;
  uint32_t port;
  const char* client_id;
  esp_err_t (*event_handle)(esp_mqtt_event_handle_t);
  int task_stack;
  int task_prio;
  int buffer_size;
  int network_timeout_ms;
  int reconnect_timeout_ms;
  int keepalive;
  int disable_clean_session;
  bool disable_auto_reconnect;
};
esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t* config);
esp_err_t esp_mqtt_client_start(esp_mqtt_client_handle_t client);
esp_err_t esp_mqtt_client_stop(esp_mqtt_client_handle_t client);
esp_err_t esp_mqtt_client_destroy(esp_mqtt_client_handle_t client);
int esp_mqtt_client_subscribe(esp_mqtt_client_handle_t client, const char* topic, int qos);
