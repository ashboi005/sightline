#include "app_shared.h"
#include "validation_url.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <cJSON.h>
#include <memory>
#include <new>

// The pinned ESP-IDF build includes its full CA bundle in libmbedtls.
extern const uint8_t kCertificateBundle[] asm("_binary_x509_crt_bundle_start");

namespace {
constexpr char kGyroEnabledKey[] = "gyro_enabled";
constexpr char kGyroRouteKey[] = "gyro_route";
constexpr char kGyroUuidKey[] = "gyro_uuid";

bool sGyroEnabled = false;
String sGyroRoute;
String sGyroUuid;

String trimTrailingSlashes(const String& input) {
  String output = input;
  output.trim();
  while (output.endsWith("/")) {
    output.remove(output.length() - 1);
  }
  return output;
}

String buildValidationUrl(const String& input) {
  String normalized = trimTrailingSlashes(input);

  if (normalized.endsWith("/api/gaze/validate/uuid")) {
    return normalized;
  }

  if (normalized.endsWith("/api")) {
    return normalized + "/gaze/validate/uuid";
  }

  return normalized + "/api/gaze/validate/uuid";
}

bool isValidValidationUrl(const String& input) {
  return validation::secureUrl(input.c_str());
}

class BoundedResponse : public Stream {
 public:
  static constexpr size_t capacity = 4096;
  char body[capacity + 1] = {};
  size_t length = 0;
  size_t write(uint8_t value) override { return write(&value, 1); }
  size_t write(const uint8_t* data, size_t count) override {
    if (count > capacity - length) return 0;
    memcpy(body + length, data, count);
    length += count;
    body[length] = '\0';
    return count;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

constexpr uint32_t kResponseDeadlineMs = 5000;

int readResponseByte(WiFiClient& input, uint32_t startedAt) {
  while (millis() - startedAt < kResponseDeadlineMs) {
    if (input.available()) {
      const int value = input.read();
      if (value >= 0) return value;
    } else if (!input.connected()) {
      return -1;
    }
    delay(1);
  }
  return -1;
}

bool readBodyBytes(WiFiClient& input, BoundedResponse& response, size_t count, uint32_t startedAt) {
  if (count > response.capacity - response.length) return false;
  for (size_t i = 0; i < count; ++i) {
    const int value = readResponseByte(input, startedAt);
    if (value < 0) return false;
    response.write(static_cast<uint8_t>(value));
  }
  return true;
}

bool readValidationBody(HTTPClient& http, BoundedResponse& response) {
  WiFiClient* input = http.getStreamPtr();
  if (!input) return false;
  const uint32_t startedAt = millis();
  String encoding = http.header("Transfer-Encoding");
  encoding.trim();
  encoding.toLowerCase();
  if (encoding == "chunked") {
    for (;;) {
      char line[96];
      size_t length = 0;
      for (;;) {
        const int value = readResponseByte(*input, startedAt);
        if (value < 0) return false;
        if (value == '\r') {
          if (readResponseByte(*input, startedAt) != '\n') return false;
          break;
        }
        if (length >= sizeof(line) - 1) return false;
        line[length++] = static_cast<char>(value);
      }
      line[length] = '\0';
      size_t count = 0, digits = 0;
      for (const char* digit = line; *digit && *digit != ';'; ++digit) {
        int value = (*digit >= '0' && *digit <= '9') ? *digit - '0'
                  : (*digit >= 'a' && *digit <= 'f') ? *digit - 'a' + 10
                  : (*digit >= 'A' && *digit <= 'F') ? *digit - 'A' + 10 : -1;
        if (value < 0 || count > response.capacity / 16) return false;
        count = count * 16 + value;
        ++digits;
      }
      if (!digits) return false;
      if (count == 0) return true;  // Caller closes HTTP; trailers are not needed.
      if (!readBodyBytes(*input, response, count, startedAt) ||
          readResponseByte(*input, startedAt) != '\r' ||
          readResponseByte(*input, startedAt) != '\n') return false;
    }
  }
  if (encoding.length() != 0 && encoding != "identity") return false;
  const int expected = http.getSize();
  if (expected >= 0) return readBodyBytes(*input, response, expected, startedAt);
  // HTTP/1.0 and connection-close responses without a Content-Length.
  for (;;) {
    const int value = readResponseByte(*input, startedAt);
    if (value < 0) return millis() - startedAt < kResponseDeadlineMs && !input->connected();
    if (response.write(static_cast<uint8_t>(value)) != 1) return false;
  }
}

bool jsonDepthSafe(const char* text) {
  int depth = 0;
  bool quoted = false, escaped = false;
  for (; *text; ++text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (*text == '\\') escaped = true;
      else if (*text == '"') quoted = false;
    } else if (*text == '"') quoted = true;
    else if (*text == '{' || *text == '[') { if (++depth > 8) return false; }
    else if (*text == '}' || *text == ']') { if (--depth < 0) return false; }
  }
  return !quoted && depth == 0;
}

bool validIdentity(const char* value) {
  if (!value || !*value || strlen(value) > 128) return false;
  for (; *value; ++value) {
    const unsigned char c = *value;
    if (!isalnum(c) && c != '-' && c != '_' && c != '.') return false;
  }
  return true;
}

bool requestGyroIdentity(
  const String& validationUrl,
  const String& email,
  const String& password,
  String& uuidOut,
  String& errorOut
) {
  uuidOut = "";
  errorOut = "";

  if (WiFi.status() != WL_CONNECTED) {
    errorOut = "Wi-Fi is not connected";
    return false;
  }

  if (!isValidValidationUrl(validationUrl)) {
    errorOut = "Validation requires HTTPS with a valid host and no embedded credentials";
    return false;
  }

  WiFiClientSecure secureClient;
  if (!isTimeKnown()) {
    errorOut = "Clock is not synced yet; retry gyro validation after NTP sync";
    return false;
  }
  secureClient.setCACertBundle(kCertificateBundle);
  secureClient.setHandshakeTimeout(5);

  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(3000);
  http.setReuse(false);
  if (!http.begin(secureClient, validationUrl)) {
    errorOut = "Unable to start validation request";
    http.end();
    return false;
  }

  const char* responseHeaders[] = {"Transfer-Encoding"};
  http.collectHeaders(responseHeaders, 1);
  http.addHeader("Content-Type", "application/json");
  String requestBody = "{\"email\":\"" + escapeJson(email) + "\",\"password\":\"" + escapeJson(password) + "\"}";

  std::unique_ptr<BoundedResponse> response(new (std::nothrow) BoundedResponse());
  if (!response) {
    errorOut = "Not enough memory for validation response";
    http.end();
    return false;
  }
  const int code = http.POST(requestBody);
  if (code != 200 && code != 201) {
    errorOut = "Validation failed (HTTP " + String(code) + ")";
    http.end();
    return false;
  }
  if (!readValidationBody(http, *response)) {
    errorOut = "Validation response is too large, incomplete or timed out";
    http.end();
    return false;
  }
  http.end();
  if (!jsonDepthSafe(response->body)) {
    errorOut = "Validation response contains invalid or deeply nested JSON";
    return false;
  }
  cJSON* document = cJSON_ParseWithOpts(response->body, nullptr, true);
  const char* keys[] = {"hashed_uuid", "uuid", "identity", "deviceId", "id"};
  const cJSON* objects[] = {document, cJSON_GetObjectItemCaseSensitive(document, "data")};
  for (const cJSON* object : objects) {
    for (const char* key : keys) {
      const cJSON* value = cJSON_GetObjectItemCaseSensitive(object, key);
      if (cJSON_IsString(value) && validIdentity(value->valuestring)) {
        uuidOut = value->valuestring;
        cJSON_Delete(document);
        return true;
      }
    }
  }
  cJSON_Delete(document);
  errorOut = "Validation response does not contain a valid UUID string";
  return false;
}
}  // namespace

void loadGyroSettings() {
  sGyroEnabled = preferences.getBool(kGyroEnabledKey, false);
  sGyroRoute = preferences.isKey(kGyroRouteKey)
    ? trimTrailingSlashes(preferences.getString(kGyroRouteKey, ""))
    : "";
  sGyroUuid = preferences.isKey(kGyroUuidKey)
    ? preferences.getString(kGyroUuidKey, "")
    : "";

  if (sGyroRoute.length() > 0) {
    sGyroRoute = buildValidationUrl(sGyroRoute);
  }

  if (sGyroEnabled && sGyroUuid.length() == 0) {
    sGyroEnabled = false;
    preferences.putBool(kGyroEnabledKey, false);
    Serial.println("Gyro was enabled without a UUID. It has been disabled.");
  }
}

bool isGyroToggleEnabled() {
  return sGyroEnabled;
}

const String& getGyroValidationRoute() {
  return sGyroRoute;
}

const String& getGyroIdentityUuid() {
  return sGyroUuid;
}

void setGyroRuntimeSettings(bool enabled, const String& validationRoute, const String& identityUuid) {
  sGyroEnabled = enabled;
  sGyroRoute = trimTrailingSlashes(validationRoute);
  if (sGyroRoute.length() > 0) {
    sGyroRoute = buildValidationUrl(sGyroRoute);
  }
  sGyroUuid = identityUuid;
}

void saveGyroSettings(bool enabled, const String& validationRoute, const String& identityUuid) {
  setGyroRuntimeSettings(enabled, validationRoute, identityUuid);
  if (preferences.getBool(kGyroEnabledKey, false) != sGyroEnabled) preferences.putBool(kGyroEnabledKey, sGyroEnabled);
  if (preferences.getString(kGyroRouteKey, "") != sGyroRoute) preferences.putString(kGyroRouteKey, sGyroRoute);
  if (preferences.getString(kGyroUuidKey, "") != sGyroUuid) preferences.putString(kGyroUuidKey, sGyroUuid);
}

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
) {
  enabledOut = false;
  routeOut = trimTrailingSlashes(validationRoute.length() > 0 ? validationRoute : sGyroRoute);
  uuidOut = sGyroUuid;
  messageOut = "";
  uuidUpdated = false;

  if (routeOut.length() > 0) {
    routeOut = buildValidationUrl(routeOut);
  }

  if (!requestedEnable) {
    messageOut = "Gyro/authentication disabled";
    return true;
  }

  if (routeOut.length() == 0) {
    messageOut = "Validation route is required when gyro is enabled";
    return false;
  }

  bool hasEmail = email.length() > 0;
  bool hasPassword = password.length() > 0;
  if (hasEmail != hasPassword) {
    messageOut = "Enter both email and password, or leave both empty";
    return false;
  }

  if (hasEmail && hasPassword) {
    String requestError;
    String newUuid;
    if (!requestGyroIdentity(routeOut, email, password, newUuid, requestError)) {
      messageOut = requestError;
      return false;
    }

    uuidUpdated = (newUuid != sGyroUuid);
    uuidOut = newUuid;
  } else if (uuidOut.length() == 0) {
    messageOut = "Validate once with email/password to create a UUID";
    return false;
  }

  enabledOut = true;
  messageOut = uuidUpdated ? "Gyro identity updated" : "Gyro identity ready";
  return true;
}
