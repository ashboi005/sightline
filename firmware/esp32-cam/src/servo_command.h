#pragma once
#include <cstddef>
#include <cstdint>

namespace servo {
constexpr size_t kMaxCommandBytes = 128;
struct Delta { int32_t x = 0; int32_t y = 0; };
bool parseDelta(const char* payload, size_t length, Delta& result);
int applyDelta(int current, int32_t delta);
bool acceptsMessage(const char* expectedTopic, const char* topic, size_t topicLength,
                    size_t dataLength, size_t totalLength, size_t offset, bool retained);
}
