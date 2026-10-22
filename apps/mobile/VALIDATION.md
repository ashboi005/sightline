# Build and validation record

Date: October 22, 2026. This record distinguishes checks on this Mac from checks that require physical camera hardware.

## Implemented

- Independent native Android project inside `apps/mobile`, with Kotlin and Jetpack Compose.
- USB video-interface enumeration; sequential device permission prompts; one native UVC session per selected camera; a maximum selection of five.
- Supported-mode negotiation, MJPEG preference, 640 × 480 / 1280 × 720 limits, up to 20 output frames per second, bounded JPEG encoding.
- Separate MJPEG and snapshot endpoints, plus a browser dashboard. Slow viewers do not create unbounded frame queues.
- Foreground notification with Stop, rotation-safe UI binding, runtime camera/local-network permission requests, network address display, camera disconnect/stall cleanup.
- Installation and beginner development instructions in [README.md](README.md).

## Completed checks

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

Start with a powered hub and one camera at 640 × 480. Confirm the frame count increases and the computer browser displays moving video. Then stop, attach a second camera, select both and repeat. Run both feeds for at least ten minutes and try locking the phone screen. Add further cameras one at a time only after two are stable. Power, USB bandwidth, camera modes, phone firmware and heat can limit the camera count.

## Scope and limits

The server is plain HTTP on port 8080 without authentication. Use a trusted LAN. It supports at most 12 simultaneous HTTP clients. Camera IDs may change after reconnection. Audio, recording, frame synchronization, internet relaying and compressed-MJPEG passthrough are not implemented. The native library decodes USB input, and Android re-encodes frames as JPEG; that adds CPU load.

Source branch: `codex/mobile-app`. The publication branch is based on `origin/main` at `38ca7358b471cabe226f651460abb5f174999837`. Only the mobile app and its root build shortcuts/documentation are included in the app commit.
