# Scene-camera calibration integration

Reference: gaze-core browser scene-camera tracking, read from the local reference on 2026-10-22. The selected dependency closure lives in apps/web/src/features/scene-tracking; the reference repository is unchanged.

## Design

Hardware / eye camera → eye region → eye model → scene camera orientation → hand, marker or one-point calibration → independent accuracy check → save and live view. Hand and marker retain nine calibration locations and five new validation locations. One-point remains explicitly estimated.

Use Sightline clay surfaces and buttons with flat camera views. One account-scoped provider owns cameras and the mapping across routes. Setup and the sidebar read the same runtime; lecture capture uses the same oriented scene stream. Named calibration profiles are stored under a versioned user-ID key in browser localStorage, with explicit reuse, replay, new and replace actions. Restored validation is previous evidence, never a fresh pass. Storage failures keep the current mapping and report the failure.

## Implementation plan

- [x] Port only the browser tracking, reference detection, fitting, validation and required control dependencies; package pinned workers locally.
- [x] Add tested account-scoped profile persistence and a shared scene runtime. Guard camera/model changes, cancellation, failed checks and stale observations.
- [x] Replace Setup with the guided clay flow. Save automatically after completion; expose naming, reuse, replay, new and replacement.
- [x] Add the scene preview immediately above the account footer, including collapsed and mobile layouts, stream status and gaze overlay. Share the camera with lecture capture.
- [x] Run frontend tests, ported calibration tests, TypeScript and production build. Inspect responsive light/dark UI, empty states and connection-error recovery.

## Network compatibility

Both eye and scene inputs retain the reference network transport unchanged: HTTP/HTTPS multipart MJPEG (including ESP32-CAM), browser-playable video, IP and mDNS addresses, redirects, and the local ESP32 `/stream` fallback to port 81. Reconnection retains the successful stream endpoint, backs off on failures, and discards damaged JPEGs without abandoning healthy subsequent frames. Setup and lecture capture share the selected network source. Browser CORS and local-network permissions still apply, as in the reference.

### Calibration capture during network gaps

Independent network streams and their detection workers can finish in either order. Scene observations now wait within the existing freshness deadline for corresponding eye evidence instead of immediately resetting the current point. Brief eye-stream silence, stale frames and temporarily unmatched timestamps pause capture within a bounded three-second recovery window. Good paired samples stay in the unfinished hold; missing frames and recovery gaps never add samples or hold time. Fresh returning evidence must still agree with the original gaze/reference anchor. Pupil loss, sustained movement and recovery expiry still restart the unfinished hold, while completed points remain saved in the current collection. Freshness, pairing skew, confidence, scatter and independent validation limits are unchanged.

Regression verification covers dropped eye frames with a live scene stream, both streams pausing, reversed worker completion order, recovery expiry and jittery five-fps input. The web suite has 283 passing tests and TypeScript passes after this fix. These are deterministic timing reproductions; physical camera testing remains separate.

Live Chrome inspection subsequently showed an additional reset path: a brief `reacquiring` detection immediately cleared an otherwise good hold, and the open page still displayed the previous timing messages from its retained session object. Locked detector reacquisition now pauses within the same bounded recovery window without making the rejected frame valid or supplying gaze. Unlocking the model, a fully lost pupil, sustained movement, and recovery expiry still invalidate unfinished evidence. The added regressions bring the web suite to 286 passing tests; TypeScript passes. A full refresh is required when testing changes to the stateful collector class because development hot updates can retain the existing instance. Refreshing also rebuilds the automatic eye model; export diagnostics before discarding an unfinished run.

## Verification

Implemented in the existing `/Users/kate/Documents/personal/sightline` checkout on `main`. Frontend tests: 161 passing, including reference network-source and network-camera tests plus profile isolation, replacement protection, camera startup and cancellation regressions. TypeScript and webpack production build pass. Browser inspection covers desktop light/dark, mobile navigation, collapsed sidebar, saved-profile empty state and invalid camera URL feedback. No physical headset or ESP32 camera was connected during verification, so physical gaze accuracy and device-specific network access remain hardware checks.

## Review focus

Account switching must never show another user's profile; a failed replacement must preserve the original; stale samples cannot advance capture or show a live gaze dot; source/orientation changes invalidate mapping; leaving setup cancels an unfinished hold but preserves completed calibration.

## Saving and recovery

Save controls are available with any completed mapping or finite failed-fit candidate, including after an unsuccessful accuracy check. Such mappings are stored as unverified drafts and cannot overwrite an accepted profile. Saving to browser storage does not require live camera connections. Storage writes are read back before reporting success.

Save as new calibration saves the current mapping as a separate profile, opens the saved library, and leaves the live setup and eye model intact. It is available once a fitted mapping exists and capture has finished. Restart setup, Replay steps and Replace preserve the current mapping before invalidating the live setup. If saving fails, they leave the current run and eye model in place and show the error. Starting a new run during active capture is rejected. Failed replacement candidates are saved separately from the accepted mapping.

Import diagnostics recovers an exported calibration mapping into the signed-in user's library without changing the live run. Imported mappings are always unverified and do not claim to match the current eye model. Raw sample histories are compacted using the same profile validator as ordinary saves. The existing diagnostic export was recovered as “Recovered calibration” in the user's Chrome profile; its persistence was verified after a full reload and starting a new run. Web verification after these changes: 298 tests and TypeScript pass.

## Scope

Frontend only. Browser-local profile persistence, not cross-device synchronization. No backend schema or daemon protocol changes. Physical accuracy requires cameras and fresh physical fixations. Voice focus currently consumes gaze from the existing bridge; its gaze transport is outside this change.
