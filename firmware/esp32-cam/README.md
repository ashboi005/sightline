# ESP32-CAM firmware

Source import from the local ESP-CAM repository, branch `codex/mqtt-servos`, commit `fe4321f` (23 October 2026). The original repository is unchanged. This directory includes application source, the pinned PlatformIO configuration, protocol documentation and small host-test stubs. It deliberately excludes `.pio`, downloaded SDKs/libraries, editor state, historical backups, recordings and export tools.

Build with `platformio run -d firmware/esp32-cam -e esp32cam`. Run the parser/controller host tests with `sh firmware/esp32-cam/test/run-servo-tests.sh`. PlatformIO downloads its pinned SDK/toolchain locally; build output remains ignored. Flashing is a separate, explicit hardware operation.

Sightline sends signed integer X deltas on `esp32cam/kate/servo/delta` at `broker.hivemq.com:1883`, QoS 0 and retain=false. Positive X turns Kate's mount left; negative X turns it right. The frontend keeps Y disabled, although the firmware's existing protocol supports both axes. Ordinary tracking is bounded to 6 degrees per command, with a 250 ms minimum interval; the temporary 50-degree demonstration is not a production mode.

See [SERIAL_PROTOCOL.md](SERIAL_PROTOCOL.md) for wiring, camera URLs, setup and status fields. Video uses HTTP MJPEG on port 81; MQTT carries servo commands, not video. The Mac/browser relay and cameras must have a working route to each other. Firmware source cannot repair a Wi-Fi subnet change.

The shared public MQTT broker/topic intentionally retains the existing access model requested for this hardware: it has no command authentication. Camera/setup endpoints are also intended for a trusted LAN. These are deployment trust boundaries, not secrets hidden in source. No personal Wi-Fi credentials or account credentials are included. Optional gyro account validation uses certificate-verified HTTPS; the source import rejects cleartext credential submission.
