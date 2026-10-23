# ESP32-CAM MQTT servo firmware

**This `codex/mqtt-servos` branch uses GPIO14 for X and GPIO15 for Y. SD recording and the record button are disabled. Remove the SD card before powering this firmware.** Live camera preview and optional gyro telemetry remain available. The `main` branch retains the earlier recording firmware.

## Servo commands

The device subscribes to the public, unauthenticated broker **`broker.hivemq.com:1883`** on the fixed command topic **`esp32cam/kate/servo/delta`**. The broker host, port and command topic are constants in `src/mqtt_config.h`; the command topic stays the same across restarts. This is separate from the optional gyro telemetry topic `eyetracker/<uuid>/gyro`. Anyone can publish to the fixed servo topic through this public broker, so it does not provide access control.

Publish one JSON object containing literal `"x"`, `"y"`, or both. Values are signed integer **degree deltas**, each in the signed 32-bit range (`-2147483648` through `2147483647`). An omitted axis holds its current position. For example, `{"x":10,"y":-5}` adds 10° to X and subtracts 5° from Y. Every command clamps each resulting angle to **0–180°** without integer overflow.

Both axes start at **90° on every boot**, after camera initialization and before network setup. Wi-Fi/MQTT loss and reconnection preserve the last commanded angles. The ESP32 does not detect targets or calculate pixel coordinates: an external application must convert its image analysis into these degree deltas.

Use **QoS 0, nonretained** messages with payloads of **at most 128 bytes**. Malformed JSON, empty commands, unknown or duplicate fields, noninteger/out-of-range values, fragmented messages and deliveries marked retained are rejected. Send normal JSON integer syntax (`5`, `-5`, `0`), without a leading `+`, decimal point or exponent. Rejected commands do not change either axis. Do not use retained commands or QoS 1/2. There is no command acknowledgement, replay queue or deduplication of separately published identical payloads; publishing the same delta twice moves twice. Check the current angles through `/status`.

```sh
mosquitto_pub -h broker.hivemq.com -p 1883 -q 0 -t 'esp32cam/kate/servo/delta' -m '{"x":10,"y":-5}'
mosquitto_pub -h broker.hivemq.com -p 1883 -q 0 -t 'esp32cam/kate/servo/delta' -m '{"x":-20}'
mosquitto_pub -h broker.hivemq.com -p 1883 -q 0 -t 'esp32cam/kate/servo/delta' -m '{"y":5}'
```

The examples intentionally omit `-r`. Retained replay on subscription is rejected, but MQTT 3.1.1 can clear the retain flag on live delivery; the publisher must always use retain=false. Small steps allow you to check axis direction before approaching either end of travel. QoS 0 commands can be lost during outages; a reconnect does not replay missed commands.

## Wiring and PWM

| Function | Pin/configuration |
| --- | --- |
| X servo signal | GPIO14 |
| Y servo signal | GPIO15 |
| Servo power | A separate supply suitable for both servos' voltage and current, with supply GND joined to ESP32 GND |
| Camera | AI Thinker layout in `src/camera_pins.h` |
| SD card / record button | Disabled; leave the SD slot empty; GPIO12 is not configured as a button |
| Indicator | GPIO4; steady during the success window, blinking while connecting/on errors |
| Optional MPU6050 | SDA GPIO3, SCL GPIO13, address 0x68 |
| Serial logging | UART0 TX GPIO1, 115200 baud; disconnect programmer TX from GPIO3 during gyro use |

The servo output uses **50 Hz** PWM with default **500–2500 µs** endpoint pulses and 1500 µs at 90°. These defaults must be checked against the actual servo model. Adjust the pulse range constants in `src/servo_module.cpp` to its supported range before using the ends of travel. The command limits describe requested angles; physical rotation depends on the servo and mechanical mounting. Do not power the servos from the ESP32's 3.3 V output. Power off before changing wiring and check cold boot with the actual GPIO15 servo connection.

## Camera and network setup

Without saved Wi-Fi credentials, join **ESP32-CAM-Setup** (password **12345678**) and open **http://192.168.4.1/setup**. Once connected, open **http://esp32.local/** or the station IP in the startup log. The viewer displays servo angles, MQTT readiness and the command topic, and reconnects preview after image errors or 15 seconds without progress. Close other viewer tabs; one active preview viewer is supported. Wi-Fi scans require the preview to be closed.

The camera stream uses **port 81**, at `http://<station-IP>:81/stream`; `/stream` on port 80 redirects there. The built-in viewer handles this URL and rotation. The raw stream has no automatic reconnection script. A disconnected device returns to setup AP mode and retries saved Wi-Fi about every 30 seconds.

| Sensor | Preferred native output | Configuration |
| --- | --- | --- |
| OV3660 | 600 × 800 portrait | Aligned 608 × 800 JPEG encoding; header trims eight right-edge pixels |
| OV2640 | 800 × 600 landscape | Standard SVGA landscape readout |

Other valid aligned sizes in the sensor's selected orientation are retained and reported in `/status`. Startup requires stable matching JPEG geometry. The firmware does not decode, rotate or re-encode images. Viewer rotation defaults to 0° and is saved separately for portrait and landscape sources. A 90° receiver rotation swaps width and height.

The camera implementation and settings are restored from the pre-servo commit `a7ad64d`. Preview targets 20 FPS, with bounded PSRAM buffers and capture/preview workers on core 1. Actual frame rate depends on camera exposure, scene complexity, Wi-Fi and power. The original recording queue, idle SD writer task and 8 KiB SD DMA staging buffer are retained, but storage mounting, the record button and recording entry point are disabled by `kSdRecordingEnabled = false`. No SD pins are initialized. The camera still requires working PSRAM. The camera pin map and sensor settings match that pre-servo version. PlatformIO retains the same platform, board, framework and upload settings; its monitor speed is restored to the earlier 115200 baud setting from `46505f4`, matching the firmware's serial output.

Gyro authentication is optional; its failure does not prevent camera, Wi-Fi or servo operation. The gyro retains its public broker topic and `yaw,pitch,roll` payload. HTTPS authentication uses the SDK CA bundle and hostname verification and requires valid NTP time. Cleartext HTTP validation is rejected before any account credentials are sent; configure an HTTPS validation URL. The local camera/setup endpoints have no login and should be used on a trusted LAN/AP. The MJPEG endpoint supports ordinary image embedding, without granting cross-origin JavaScript pixel access.

## Status and validation

`/status` and the viewer report `servoReady`, `servoMqttConnected`, `servoX`, `servoY`, `servoTopic`, `servoError` and `servoRejectedCommands`. The serial monitor logs each received servo command with its deltas and resulting positions; rejected commands and PWM failures are logged too. `servoReady` describes PWM setup; `servoMqttConnected` indicates subscription readiness. `recordingEnabled` and `sdReady` are always false. Legacy recording counters remain present for client compatibility and stay zero. Camera capture/preview counts, dimensions, errors and free heap/PSRAM remain available.

Build the pinned `espressif32@7.1.3` environment:

```sh
platformio run -e esp32cam
sh test/run-servo-tests.sh
```

The host tests compile the production parser and servo controller with address/undefined-behavior sanitizers. Controller tests simulate only the hardware, Wi-Fi, preferences and MQTT interfaces, covering startup centering, movement, rejection and subscription/reconnect recovery. No external test library is required. The firmware build separately checks integration with the installed ESP32 SDK.

Uploads use 115200 baud. Close Serial Monitor, leave the SD card removed and enter download mode with GPIO0 low during reset. After uploading, power off, remove any GPIO0-to-GND jumper and power on. Serial output and the PlatformIO monitor default both use 115200 baud; run `platformio device monitor`.

Host builds and command tests cannot establish physical 0–180° travel, supply stability, GPIO boot behavior or camera throughput. Before using this firmware with the mechanism:

1. Confirm the servo model's pulse limits and supply requirements. With safe mechanical clearance, cold boot and check both axes center at 90° while the camera starts.
2. Open preview and send small positive/negative commands on each axis, then together. Check `/status` angles and the actual direction of movement.
3. Approach each end of travel gradually after confirming the pulse limits. Check clamping, rejected input and preview operation during servo movement.
4. Disconnect/reconnect Wi-Fi or MQTT and confirm both axes hold their last positions. Reboot and confirm both return to 90°.

## Legacy recording design

Earlier Git versions supported simultaneous MJPEG preview and numbered JPEG/`frames.csv` recording under `/recordings/<timestamp-or-id>/`, with a physical GPIO12 button and SD_MMC 1-bit wiring on GPIO14/GPIO15/GPIO2. That design and the export tools (including `tools/command.md`) apply only to recordings made by the earlier recording firmware. This branch retains the original pipeline but disables storage startup and recording to free GPIO14/GPIO15 for servos. Old SD recording instructions and historical recording performance measurements do not describe this build.
