#include "servo_command.h"
#include <cstdio>
#include <cstring>
#include <cstdint>

namespace {
int failures = 0;
void expect(bool condition, const char* name) {
  if (!condition) { std::fprintf(stderr, "FAIL: %s\n", name); ++failures; }
}
bool parse(const char* text, servo::Delta& delta) {
  return servo::parseDelta(text, std::strlen(text), delta);
}
}

int main() {
  servo::Delta delta;
  expect(parse("{\"x\":5,\"y\":-3}", delta) && delta.x == 5 && delta.y == -3,
         "accept signed changes for both axes");
  int x = servo::applyDelta(90, delta.x);
  int y = servo::applyDelta(90, delta.y);
  expect(x == 95 && y == 87, "first command is relative to the centered position");
  expect(parse(" { \"y\" : 7 } \n", delta) && delta.x == 0 && delta.y == 7,
         "missing X has no movement, regardless of previous command");
  expect(servo::applyDelta(x, delta.x) == 95 && servo::applyDelta(y, delta.y) == 94,
         "axis-only command preserves the other position");
  expect(parse("{\"x\":0}", delta) && delta.x == 0 && delta.y == 0, "zero is a valid change");
  expect(parse("{\"x\":2147483647,\"y\":-2147483648}", delta), "accept full signed integer range");
  expect(servo::applyDelta(90, delta.x) == 180 && servo::applyDelta(90, delta.y) == 0,
         "large deltas clamp without integer overflow");
  expect(servo::applyDelta(179, 5) == 180 && servo::applyDelta(1, -5) == 0,
         "movement clamps at both endpoints");
  expect(servo::applyDelta(180, -1) == 179 && servo::applyDelta(0, 1) == 1,
         "movement reverses immediately away from a bound");

  const char* invalid[] = {
    "", "{}", "[]", "null", "5", "{", "{\"x\":}", "{\"x\":5}junk",
    "{\"x\":\"5\"}", "{\"x\":true}", "{\"x\":null}", "{\"x\":[]}",
    "{\"x\":1.5}", "{\"x\":01}", "{\"x\":-01}", "{\"x\":1.}", "{\"x\":1e}",
    "{\"x\":1.0}", "{\"x\":1e2}", "{\"x\":+5}", "{\"x\":- 5}", "{\"x\":2147483648}", "{\"x\":-2147483649}", "{\"x\":1e400}",
    "{\"z\":1}", "{\"X\":1}", "{\"x\":1,\"x\":2}", "{\"y\":1,\"y\":2}",
    "{\"x\":5,\"y\":\"bad\"}", "{\"x\":5,\"z\":2}", "{\"x\\u0000junk\":5}"
  };
  for (const char* input : invalid) {
    delta.x = 11; delta.y = 12;
    expect(!parse(input, delta), input);
    expect(delta.x == 11 && delta.y == 12, "reject whole command without a partial update");
  }
  const char withoutTerminator[] = {'{', '\"', 'x', '\"', ':', '5', '}'};
  expect(servo::parseDelta(withoutTerminator, sizeof(withoutTerminator), delta) && delta.x == 5,
         "payload uses its explicit length, not a trailing terminator");
  char maximumLength[128]; std::memset(maximumLength, ' ', sizeof(maximumLength));
  std::memcpy(maximumLength, "{\"x\":5}", 7);
  expect(servo::parseDelta(maximumLength, sizeof(maximumLength), delta), "accept valid maximum-size command");
  const char withNull[] = "{\"x\":5}\0{\"y\":6}";
  expect(!servo::parseDelta(withNull, sizeof(withNull) - 1, delta), "embedded NUL cannot hide trailing data");
  expect(!servo::parseDelta(nullptr, 5, delta), "reject missing payload");
  char oversized[130]; std::memset(oversized, ' ', sizeof(oversized));
  expect(!servo::parseDelta(oversized, sizeof(oversized), delta), "reject oversized payload before parsing");

  const char* topic = "esp32cam/device/servo/delta";
  const size_t topicLength = std::strlen(topic);
  expect(servo::acceptsMessage(topic, topic, topicLength, 7, 7, 0, false), "accept a live complete command");
  expect(!servo::acceptsMessage(topic, topic, topicLength, 7, 7, 0, true), "do not replay retained deltas");
  expect(!servo::acceptsMessage(topic, topic, topicLength, 3, 7, 0, false), "reject first fragment");
  expect(!servo::acceptsMessage(topic, topic, topicLength, 4, 7, 3, false), "reject later fragment");
  expect(!servo::acceptsMessage(topic, topic, topicLength, 129, 129, 0, false), "reject oversized MQTT command");
  expect(!servo::acceptsMessage(topic, topic, topicLength, 0, 0, 0, false), "reject empty MQTT command");
  expect(!servo::acceptsMessage(topic, topic, topicLength - 1, 7, 7, 0, false), "topic must match exactly");
  expect(!servo::acceptsMessage(topic, "esp32cam/device/servo/other", topicLength, 7, 7, 0, false), "reject other topics");
  expect(!servo::acceptsMessage(topic, nullptr, 0, 7, 7, 0, false), "reject missing topic");
  if (failures) return 1;
  std::puts("Servo command tests passed: movement, bounds, validation, MQTT message filtering.");
  return 0;
}
