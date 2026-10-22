# Android USB streaming implementation

Goal: an installable Kotlin/Jetpack Compose APK in apps/mobile that turns attached UVC webcams into individual MJPEG streams on the phone's local network.

The user explicitly authorized implementation. The separate clone is under ~/Desktop/Codex-projects/sight-mobile, following the user's folder rule. Publishing the mobile app source on its own branch is authorized. This Android Gradle project lives in the existing monorepo but does not depend on its web server, database, or Bun packages.

## Design

- Compose controls select attached cameras, quality, and start/stop. Start at 640 × 480, 20 fps, JPEG quality 75; offer 1280 × 720 at 20 fps. Up to five distinct USB devices may be selected, subject to hardware capacity.
- A foreground service owns one direct UVC session per selected camera, using UVCAndroid 1.0.13. This avoids depending on the vendor's Camera2 external-camera provider. A real USB host and UVC-compatible cameras are still required.
- Each camera negotiates supported modes. JPEG encoding is bounded to one outstanding frame per camera; the server broadcasts the latest frame independently to each viewer. Slow viewers cannot accumulate capture queues.
- One local HTTP server serves a browser dashboard, per-camera multipart MJPEG, snapshots, and health information. HTTP is unauthenticated and intended for a trusted LAN; no cloud deployment or public exposure.
- Capture continues under a foreground notification; explicit Stop releases camera handles, sockets and power locks. USB permission denial and detach affect that camera only. Status never calls a camera live before frames arrive.
- UI: light cool-gray base (#F2F6F7), white surfaces, dark blue-gray text (#20343C), teal controls (#176A74), red errors (#BA1A1A). System sans typography, large left-aligned title, clear device rows with individual status and links. Camera identity and actions take priority over decoration.

## Tasks

- [x] Configure current stable Android tooling, Gradle wrapper and APK build.
- [x] Implement bounded HTTP streaming and real loopback tests (multiple readers, framing, removal, shutdown, invalid requests).
- [x] Implement USB enumeration, sequential permissions, supported-mode selection, per-camera capture and safe cleanup; test mode selection.
- [x] Implement service lifecycle, permissions, network address discovery, Compose selection and status.
- [x] Build debug APK, run direct Kotlin unit checks and Android lint, inspect APK permissions and native-library compatibility, review resource ownership. See apps/mobile/VALIDATION.md for exact scope and final-check limits.
- [x] Write beginner setup, APK installation, wireless debugging, browser viewing, and hardware troubleshooting instructions.

## Verification limits

Compilation and socket tests cannot establish that a particular phone/hub/camera combination supports simultaneous capture. Physical capture, USB detach, permission dialogs, and background streaming require device validation. Report these separately from build success. Hardware validation starts with one camera, then two, then additional cameras at low resolution.

## Delivery

Clone: `~/Desktop/Codex-projects/sight-mobile`. Installable debug APK: `apps/mobile/artifacts/sightline-usb-debug.apk`. Beginner guide: `apps/mobile/README.md`. Source branch: `codex/mobile-app`, based on the latest `origin/main` at publication. Generated APKs, local SDK configuration, signing keys, and build caches are excluded from Git. Physical one/two/five-camera validation is still required on the user's phone and hub.
