# Android USB streaming implementation

Goal: an installable Kotlin/Jetpack Compose APK in apps/mobile that turns phone cameras and attached UVC webcams into individual MJPEG streams on the phone's local network.

The user explicitly authorized implementation. The separate clone is under ~/Desktop/Codex-projects/sight-mobile, following the user's folder rule. Publishing the mobile app source on its own branch is authorized. This Android Gradle project lives in the existing monorepo but does not depend on its web server, database, or Bun packages.

## Design

- Compose controls select attached cameras, quality, and start/stop. Start at 640 × 480, 20 fps, JPEG quality 75; offer 1280 × 720 at 20 fps. Up to five distinct USB devices may be selected, subject to hardware capacity.
- A foreground service owns one direct UVC session per selected camera, using UVCAndroid 1.0.13. This avoids depending on the vendor's Camera2 external-camera provider. A real USB host and UVC-compatible cameras are still required.
- Built-in cameras use Camera2 with YUV ImageReaders. Discovery includes front/rear devices and readable physical lenses. Logical/physical hardware overlaps are rejected; separate phone devices use advertised concurrent combinations and session-configuration checks. A shared logical device can serve up to two physical lenses. Every concurrent device opens before sessions are configured.
- A camera coordinator merges discovery and tracks phone/USB batch completion separately. Failure of one backend leaves the other running. Each backend removes only its own frame channels; stale camera callbacks are discarded and pending close callbacks precede new phone-camera opens.
- Phone YUV buffers honor row/pixel stride and crop, rotate according to sensor/device orientation, and enter a bounded JPEG queue at up to 20 FPS. Camera permission is required for both kinds; USB hardware is optional for installation and phone-only use.
- Each camera negotiates supported modes. JPEG encoding is bounded to one outstanding frame per camera; the server broadcasts the latest frame independently to each viewer. Slow viewers cannot accumulate capture queues.
- One local HTTP server serves a browser dashboard, per-camera multipart MJPEG, snapshots, and health information. HTTP is unauthenticated and intended for a trusted LAN; no cloud deployment or public exposure.
- Capture continues under a foreground notification; explicit Stop releases camera handles, sockets and power locks. USB permission denial and detach affect that camera only. Status never calls a camera live before frames arrive.
- UI follows `apps/web/design-context.md`: chalk background (#F3F4F1), ink text (#16181C), marigold actions (#F5B301), sage device states, lilac connection panels, and subtle clay depth. Bundled Atkinson Hyperlegible Next type, the shared gaze logo, and a saved light/dark toggle carry the web identity into native Compose. A camera selection sheet, persistent Start/Stop action, flat readable links, and expandable connection help keep setup clear. Large-text layouts, semantic controls and real camera status take priority over decoration.
- The camera picker groups Phone and USB sources. The main screen keeps selected cameras, status, quality, viewing links and Start/Stop; setup paragraphs, compatibility notes and privacy detail live in Help. No redundant frame counter or per-camera raw URL blocks.

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
