#include "servo_command.h"
#include <cstring>

namespace servo {
namespace {
// The wire format is deliberately small: literal x/y keys and integer tokens.
// Parse only that schema, with bounded reads and no heap allocation.
class CommandReader {
 public:
  CommandReader(const char* data, size_t length) : cursor_(data), end_(data + length) {}

  bool take(char expected) {
    skipWhitespace();
    if (cursor_ == end_ || *cursor_ != expected) return false;
    ++cursor_;
    return true;
  }

  bool readAxis(char& axis) {
    skipWhitespace();
    if (end_ - cursor_ < 3 || cursor_[0] != '"' || cursor_[2] != '"' ||
        (cursor_[1] != 'x' && cursor_[1] != 'y')) return false;
    axis = cursor_[1];
    cursor_ += 3;
    return true;
  }

  bool readInteger(int32_t& value) {
    skipWhitespace();
    const bool negative = cursor_ != end_ && *cursor_ == '-';
    if (negative) ++cursor_;
    if (cursor_ == end_ || *cursor_ < '0' || *cursor_ > '9') return false;
    const bool leadingZero = *cursor_ == '0';
    const char* firstDigit = cursor_;
    const int64_t limit = negative ? 2147483648LL : 2147483647LL;
    int64_t magnitude = 0;
    while (cursor_ != end_ && *cursor_ >= '0' && *cursor_ <= '9') {
      if (leadingZero && cursor_ != firstDigit) return false;
      magnitude = magnitude * 10 + (*cursor_++ - '0');
      if (magnitude > limit) return false;
    }
    value = static_cast<int32_t>(negative ? -magnitude : magnitude);
    return true;
  }

  bool finished() { skipWhitespace(); return cursor_ == end_; }

 private:
  void skipWhitespace() {
    while (cursor_ != end_ && (*cursor_ == ' ' || *cursor_ == '\t' || *cursor_ == '\r' || *cursor_ == '\n')) ++cursor_;
  }
  const char* cursor_;
  const char* end_;
};
}  // namespace

bool parseDelta(const char* payload, size_t length, Delta& result) {
  if (!payload || length == 0 || length > kMaxCommandBytes) return false;
  CommandReader reader(payload, length);
  if (!reader.take('{')) return false;
  bool hasX = false, hasY = false;
  Delta candidate;
  for (;;) {
    char axis;
    int32_t value;
    if (!reader.readAxis(axis) || !reader.take(':') || !reader.readInteger(value)) return false;
    if (axis == 'x' && !hasX) { candidate.x = value; hasX = true; }
    else if (axis == 'y' && !hasY) { candidate.y = value; hasY = true; }
    else return false;
    if (reader.take('}')) break;
    if (!reader.take(',')) return false;
  }
  if (!reader.finished()) return false;
  result = candidate;
  return true;
}

int applyDelta(int current, int32_t delta) {
  const int64_t next = static_cast<int64_t>(current) + delta;
  return next < 0 ? 0 : (next > 180 ? 180 : static_cast<int>(next));
}

bool acceptsMessage(const char* expectedTopic, const char* topic, size_t topicLength,
                    size_t dataLength, size_t totalLength, size_t offset, bool retained) {
  return !retained && expectedTopic && topic && offset == 0 &&
         dataLength > 0 && dataLength <= kMaxCommandBytes && totalLength == dataLength &&
         topicLength == std::strlen(expectedTopic) && std::memcmp(topic, expectedTopic, topicLength) == 0;
}
}  // namespace servo
