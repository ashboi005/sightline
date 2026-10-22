# Gaze bridge

**Software: Ashwath · tracker hardware + gaze estimation: Arunya.** Local WebSocket server (default
`ws://localhost:7777`) that turns eye-tracker output into what the web app needs:

- `gaze.zone`: SCREEN / BOARD / PERSON / AWAY / UNKNOWN, debounced 150 ms, 1 Hz heartbeat. Drives Deaf-mode
  caption pause, bookmark and catch-up.
- `gaze.scene`: gaze in the scene-camera image (15 Hz). Drives look-to-hear face selection with the
  speaker service.
- `gaze.point` (opt-in), calibration flow, `device.status`, `gaze.targets`.

Protocol: [`docs/contracts/gaze-bridge.md`](../../docs/contracts/gaze-bridge.md).

```sh
uv sync
uv run gaze-bridge --tracker fake      # scripted student: screen → board → classmate → …
uv run pytest -q                       # zone logic + every emitted message validated against the contract schema
```

## Plugging in the real tracker

Everything hardware-specific lives in `gaze_bridge/tracker.py`:

1. Implement a `TrackerSource` whose `read()` returns the latest `TrackerSample`: eye state, optional
   on-screen point, room yaw/pitch, and the scene-camera gaze point.
2. Register it in `create_tracker()` and run `uv run gaze-bridge --tracker <name>`.

Zone thresholds live in `zones.ZoneConfig`. The "look at the board" calibration step sets `board_pitch_deg` from the
measured pitch.
