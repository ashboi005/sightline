# Build and validation record

Updated: October 23, 2026. This record distinguishes checks on this Mac from checks that require physical camera hardware.

## Phone cameras and shorter UI — version 0.2.0

- Added Camera2 discovery/capture for front, rear, other public camera devices, and readable physical lenses. Camera2 external IDs are omitted to avoid duplicating USB sources captured through UVC.
- Phone and USB sources share the picker, foreground service and independent MJPEG/snapshot endpoints. A coordinator preserves a healthy backend when the other exhausts its selected cameras.
- Separate phone devices are checked against Android 11+ concurrent sets and actual session configurations. All participating devices open before sessions are configured. Logical/physical overlap is rejected. Up to two physical lenses can share one logical-device session; older Android versions allow one device group.
- Phone capture copies YUV planes with crop/stride handling, rotates pixels using the sensor/device orientation, and JPEG-encodes on a bounded executor at a 20 FPS target. Device close callbacks precede replacement opens, stale frames cannot publish into a replacement session, and a 15-second frame watchdog handles stalled phone groups.
- USB host support is optional; phone-only capture starts a camera foreground service without the connected-device type. Existing package ID and local signing identity are retained; the launcher name is now Sightline.
- Main-screen paragraphs, frame counters and redundant individual URL blocks were removed. Phone/USB camera groups, selection, status, quality, links and Start/Stop remain. Long setup/privacy/compatibility content is in Help.

Verification: Android APK compilation and lint completed successfully with no lint issues. Unit tests were not added or run for this change. No physical device is attached: camera discovery on specific phones, permissions, YUV colors/rotation, real FPS, concurrent phone capture, mixed phone/USB capture and Stop/restart still require device validation. The earlier Studio preview limitation also remains.

Final package checks: version code 4 / version 0.2.0; label Sightline; merged USB-host feature is optional (explicitly replaces the UVC library's required feature). APK Signature Scheme v2 verifies, its signing certificate matches version 0.1.2, and 16 KB ZIP alignment passes. APK size: 21,415,801 bytes. SHA-256: `4c9dd34392b19336233218b8afecc6fd83da490be77583d1cf528cf3a754f298`.

## Interface refresh — version 0.1.2

The native UI now follows `apps/web/design-context.md`: chalk/marigold colors, clay panels, bundled Atkinson Hyperlegible Next, Sightline's gaze logo, and saved light/dark appearance. Camera selection uses an accessible multi-select sheet; Start/Stop stays visible; copy actions give feedback; connection help expands in place. Links remain on flat reading surfaces. Active quality comes from the capture service when reopening the screen.

- `./scripts/android.sh :app:assembleDebug :app:lintDebug --console=plain` completed successfully. Android lint: no issues.
- Main body, secondary text, primary-button, sage-status and lilac-status color pairs were calculated in light and dark themes: all exceed 4.5:1 contrast.
- Debug previews are included for empty, connected, live sample data, dark, 200% text, and landscape states. Sample cameras are isolated to debug preview code, never the runtime USB source.
- Visual rendering was attempted with Android CLI and installed Android Studio Quail 2 (2026.1.2 Patch 1). Studio sync rejected AGP 9.4.1 because that Studio version supports at most 9.3.1; no preview screenshots were produced. Update Studio before rendering the supplied previews. Layouts have not been visually verified on a phone or emulator.
- APK Signature Scheme v2 verification and 16 KB ZIP alignment checks pass.
- Version code 3; APK size 21,900,368 bytes.
- SHA-256: `69c2780fa2f41dfcc8328f9d6658108af53379734546460ad6ff27a5b2775f5b`.
- Unit tests were not rerun for this interface change. The 26-test result below belongs to version 0.1.1.

The physical camera/hub checks listed below remain outstanding.

## Implemented

- Independent native Android project inside `apps/mobile`, with Kotlin and Jetpack Compose.
- USB video-interface enumeration; sequential device permission prompts; one native UVC session per selected camera; a maximum selection of five.
- Supported-mode negotiation, MJPEG preference, 640 × 480 / 1280 × 720 limits, up to 20 output frames per second, bounded JPEG encoding.
- Separate MJPEG and snapshot endpoints, plus a browser dashboard. Slow viewers do not create unbounded frame queues.
- Foreground notification with Stop, rotation-safe UI binding, runtime camera/local-network permission requests, network address display, camera disconnect/stall cleanup.
- Installation and beginner development instructions in [README.md](README.md).

## Earlier checks — version 0.1.1

On the publication branch after the 20 FPS update, the Gradle Android unit-test suite completed with 26 passing tests:

- 13 HTTP/stream tests: real loopback sockets, independent cameras and viewers, multipart bytes, snapshots, invalid requests, HTML escaping, request/connection limits, stalled viewers, camera removal, and shutdown/restart.
- 8 camera-mode selection tests.
- 5 capture-batch completion tests.

The camera engine was also compiled against the actual UVCAndroid 1.0.13 AAR and Android API 37 classes. These checks do not exercise native USB transfers on Android.

Final version 0.1.1 checks: `./scripts/android.sh :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --console=plain` completed successfully. Android lint reported no issues (0 errors, 0 warnings). The intentionally unbounded foreground-session wake lock has a narrowly scoped lint suppression; Stop, startup failure, camera-batch exhaustion, and service destruction release it.

Package inspection passed:

- APK Signature Scheme v2 verifies with the local Android debug certificate.
- APK ZIP alignment passes `zipalign -c -P 16 4`.
- All 12 bundled arm64/x86_64 native libraries have ELF LOAD alignment of at least 16 KB.
- ABIs: arm64-v8a, armeabi-v7a, x86, x86_64. Minimum Android API 26; target API 37.
- The merged manifest has no microphone or storage permission. The capture service is not exported.
- APK size: 21,053,533 bytes.
- SHA-256: `0434dcbfaaa4656e614a54a03822f17ea64163e5f91d91b690564f4e46f65b05`.

These Gradle checks include the watchdog scheduling and 20 FPS mode-selection/frame-pacing changes. Physical device behavior, including achieved FPS, remains unverified.

## Physical device checks still required

No authorized physical Android device was connected during development. The following outcomes are unverified:

- Launch and permission dialogs on your phone.
- Actual JPEG capture from your UVC camera models.
- Two or five cameras running simultaneously through your hub.
- Hot unplug/reconnect and background/screen-off capture on your phone's Android build.
- Browser viewing over your Wi-Fi/hotspot.

Start with a rear phone camera at 640 × 480 and confirm that its status becomes Streaming and a computer browser displays moving video. Stop and repeat for the selfie camera, including portrait/landscape rotation and readable text. Then try a supported front/rear pair and any exposed physical lenses. Check that incompatible logical/lens selections show a clear error. Next use a powered hub with one USB camera, then a phone/USB pair, then two USB cameras. Unplug USB while a phone feed runs and confirm the phone feed continues. Deny camera permission at Start, then grant it and retry; also toggle Android's camera privacy switch, stop/restart, rotate the app and lock the screen. Run supported pairs for at least ten minutes. Add further cameras one at a time only after two are stable. Hardware capacity and actual FPS remain unverified until those checks are performed.

## Scope and limits

The server is plain HTTP on port 8080 without authentication. Use a trusted LAN. It supports at most 12 simultaneous HTTP clients. Camera IDs may change after reconnection. Audio, recording, frame synchronization, internet relaying and compressed-MJPEG passthrough are not implemented. The native library decodes USB input, and Android re-encodes frames as JPEG; that adds CPU load.

Source branch: `codex/mobile-app`. The publication branch is based on `origin/main` at `38ca7358b471cabe226f651460abb5f174999837`. Only the mobile app and its root build shortcuts/documentation are included in the app commit.
