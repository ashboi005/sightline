# Arunya — Eye Tracker Hardware & Gaze

> Back to [overview](../00-overview.md). The bridge protocol your tracker ends up behind:
> [contracts/gaze-bridge.md](../contracts/gaze-bridge.md).

## Mission

Make the custom eye tracker accurate and reliable, on the screen and in the room. Everything we build on
gaze depends on it:

- **Deaf mode:** is the student looking at the laptop or up at the board? This drives caption pause, bookmark and catch-up.
- **Hard-of-hearing mode:** which person is the student looking at? This drives "the voice you look at is the voice you hear".

## You own

| Thing | Notes |
| --- | --- |
| Tracker hardware (camera/IR, mount, wiring) | Low-cost build, robust in a classroom |
| Firmware / driver | Stable frame rate, low latency |
| Gaze estimation | On-screen point **and** direction in 3D space in front of the student |
| Calibration accuracy | Screen corners + "look at the board" + per-person directions |

## You do NOT own (Ashwath owns these now)

- The **gaze bridge software** (`apps/gaze-bridge`): turning your gaze output into zones/targets and the WebSocket
  protocol the web app consumes.
- **Gaze-directed voice isolation** (look → hear) and audio routing to the earphones.
- Any UI (Sahil) or backend (Tushar / Ashwath).

## The handshake with Ashwath

Ashwath's bridge reads your tracker output. Agree on one small interface and keep it stable:

| Signal | Shape (proposal) | Rate |
| --- | --- | --- |
| On-screen gaze point | normalised `x, y` (0..1) + `valid` flag | ≥ 30 Hz |
| Gaze direction in the room | yaw/azimuth (deg, −90 left … +90 right), pitch (deg) | ≥ 30 Hz |
| **Scene-camera gaze point** (look → hear) | normalised `x, y` in the scene camera image + `valid` + confidence | ≥ 15 Hz |
| Scene camera frames | the forward-facing camera's frames (or its stream URL) | 15–25 fps |
| Eye state | open / blink / lost | per frame |
| Calibration hooks | start, capture point, result quality | on demand |

How it's transported is your call: a Python function, a local socket or serial. Document it in
`apps/gaze-bridge/README.md` once it's settled. Until then, the bridge runs with a fake tracker so nobody is blocked.

## Done when

- [ ] Screen vs board is classified correctly ≥ 95% of the time at a normal desk distance
- [ ] Looking at person A vs person B (≥ 30° apart) is distinguishable
- [ ] Blinks don't produce false zone flips (Ashwath's bridge debounces, but clean input helps)
- [ ] The tracker reports when it's disconnected or has lost the eyes
