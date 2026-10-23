#include "app_shared.h"
#include "servo_module.h"

void setup() {
  // Keep serial logs on UART0 TX (GPIO1) while leaving UART0 RX unassigned
  // so GPIO3 can be reused for the gyro during normal runtime.
  Serial.begin(115200, SERIAL_8N1, -1, 1);
  delay(250);
  Serial.println();
  Serial.println("ESP32-CAM booting");
  Serial.println("Serial logging is TX-only on GPIO1; keep programmer TX disconnected from GPIO3 for gyro control");

  if (indicatorPinUsable()) {
    pinMode(kIndicatorLedPin, OUTPUT);
    digitalWrite(kIndicatorLedPin, LOW);
    Serial.print("Indicator LED ready on GPIO");
    Serial.println(kIndicatorLedPin);
  } else {
    Serial.println("Indicator LED pin disabled because it conflicts with the active board wiring");
  }

  Serial.println("SD recording and record button disabled: GPIO14/GPIO15 are reserved for X/Y servos; remove the SD card");

  if (!preferences.begin("wifi-config", false)) {
    Serial.println("Preferences unavailable; settings will not survive reboot");
  }
  WiFi.persistent(false);
  loadGyroSettings();
  loadConnectionError();

  if (!initCamera()) {
    Serial.println("Continuing without a working camera");
  }

  // Preserve the original camera-first startup before enabling servo output.
  if (!servoBegin()) {
    Serial.println("Continuing without working servo control; see /status for the error");
  }

  registerRoutes();
  if (loadCredentials(savedSsidCache, savedPasswordCache)) {
    PendingConnectionRequest request;
    request.active = true;
    request.keepAccessPoint = false;
    request.ssid = savedSsidCache;
    request.password = savedPasswordCache;
    request.gyroEnabled = isGyroToggleEnabled();
    request.validationRoute = getGyroValidationRoute();

    startConnectionAttempt(request);
  } else {
    startConfigMode();
  }
}

void loop() {
  server.handleClient();

  if (apActive) {
    dnsServer.processNextRequest();
  }

  processRuntimeState();
  servoLoop();
  delay(1);
}
