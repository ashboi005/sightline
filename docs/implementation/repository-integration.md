# Camera integration verification — 23 October 2026

The original Sightline checkout remains on `main`. Upstream was fast-forwarded from `ee8b2d2` to `c4a1642` (29 commits). A recoverable pre-sync stash preserves all local work. A SHA-256 manifest checked all 317 original changed/new files after restoration: 315 remained identical; only `capture-card.tsx` and `sidebar.tsx` merged with upstream changes. Their recording/camera behavior and incoming navigation styling were retained. No upstream files were removed.

The source is committed in parts: local vision service; browser tracking/runtime and dependency preparation; setup/sidebar integration; ESP32-CAM firmware; documentation. No model weights, generated workers/WASM, installed packages, Python environments, PlatformIO libraries/toolchains, private recordings, personal calibration data, editor state or historical firmware backup directories are committed.

## Dependencies and source checks

- Bun audit: no reported advisories after overriding UUID to patched 11.1.1 and removing the `shadcn` generator CLI dependency. The app used that package only for its runtime stylesheet; that exact stylesheet is retained locally with its MIT license, preserving UI behavior without the CLI's vulnerable transitive `braces` dependency. Upstream advisories: [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Python audit: no known vulnerabilities reported after updating Certifi to 2026.10.19, Pillow to 13.0.0, and Pytest to 9.1.1. Dependency constraints and `uv.lock` retain those fixes.
- Gitleaks: no credential findings in the proposed changed/new source files. Local `.env` values, credentials and private captures are excluded.
- The MediaPipe hand model is downloaded from its versioned official HTTPS URL and SHA-256 checked by `prepare:vision`; its ignored binary is not versioned. Other models and browser runtimes retain their pinned preparation processes and licenses.

These checks cover known advisories and detected secrets, not a guarantee against every possible vulnerability. The fixed MQTT broker, port and topic are an explicit hardware deployment choice and remain unchanged.

## Firmware import

`firmware/esp32-cam` contains source from ESP-CAM `codex/mqtt-servos`, commit `fe4321f`, without changing that original repository. The import adds a tested HTTPS-only account-validation policy so optional gyro login cannot submit credentials over cleartext HTTP. Certificate validation remains enabled. This does not change camera MJPEG transport or the existing MQTT protocol. It does not flash the ESP.

Servo parser/controller and HTTPS URL-policy host tests pass with address/undefined-behavior sanitizers. The pinned `espressif32@7.1.3` firmware build passes. Its generated binary remains outside the tracked source tree. The MQTT configuration header is byte-identical to the original firmware; frontend following sends only X.

## Merged-tree validation

- Frontend: 326 tests pass.
- Backend: 106 tests pass; 15 tests requiring external services/credentials are skipped by the existing suite.
- Vision: 180 tests pass; Ruff passes.
- All TypeScript workspaces type-check, and the web production build passes.
- Existing Varlock dynamic-import and TorchScript deprecation warnings remain.

The live timing fix is covered by controller and scheduled-service regressions. Final hardware following remains a live validation item because the camera network changed subnets and became unreachable during testing; the user confirmed network instability. The earlier temporary X=-50/X=+50 hardware demonstration produced clear movement and return, but is not a normal tracking mode or evidence of closed-loop centering. Y remains disabled in Sightline.
