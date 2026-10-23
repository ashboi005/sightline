#pragma once
#include <cstring>

namespace validation {
// Shared by the firmware request boundary and its dependency-free host tests.
inline bool secureUrl(const char* url) {
  if (!url || std::strncmp(url, "https://", 8) != 0) return false;
  const char* host = url + 8;
  if (!*host || *host == '/' || *host == '?' || *host == '#') return false;
  for (const char* character = host; *character && *character != '/' && *character != '?' && *character != '#'; ++character) {
    if (static_cast<unsigned char>(*character) <= 32 || *character == '@' || *character == '\\') return false;
  }
  return true;
}
}  // namespace validation
