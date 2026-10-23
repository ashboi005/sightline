#pragma once
#include <cstdint>

struct ServoStatus {
  bool ready;
  bool mqttConnected;
  int x;
  int y;
  uint32_t rejectedCommands;
  const char* error;
};

bool servoBegin();
void servoLoop();
ServoStatus servoStatus();
const char* servoCommandTopic();
