#include "validation_url.h"
#include <cassert>
#include <iostream>

int main() {
  assert(validation::secureUrl("https://api.example.com/api/gaze/validate/uuid"));
  assert(validation::secureUrl("https://192.168.1.2:8443/api"));
  assert(!validation::secureUrl("http://api.example.com/api"));
  assert(!validation::secureUrl("https://"));
  assert(!validation::secureUrl("https:///api"));
  assert(!validation::secureUrl("https://user:password@example.com/api"));
  assert(!validation::secureUrl("https://example.com\\@other.example/api"));
  assert(!validation::secureUrl("https://example.com /api"));
  assert(!validation::secureUrl(nullptr));
  std::cout << "HTTPS validation policy tests passed\n";
}
