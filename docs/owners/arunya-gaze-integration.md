# Arunya: hooking the eye tracker into Sightline

**Short version:** neither gaze feature uses our backend. Your tracker talks to a small program on the student's
laptop (the **gaze bridge**), the bridge talks to the **browser**, and the browser does the rest. The frontend
already handles both features (tested with a fake tracker), so it needs no changes once your tracker speaks
the bridge's language.

## The two features, in plain words

### 1. Looking up from the laptop → captions pause (Deaf mode)

- Your tracker says where the student is looking. The bridge turns that into a **zone**: `SCREEN` (laptop),
  `BOARD` (front of the class), `PERSON` (someone specific), `AWAY`, or `UNKNOWN` (blink / eyes lost).
- The browser gets the zone. When it isn't `SCREEN`, the browser **freezes the caption scroll** and drops a
  bookmark. Captions keep arriving in the background. When the zone is `SCREEN` again, it highlights the lines
  the student missed and catches up. `UNKNOWN` is ignored, so blinks don't pause anything.
- **No server call is involved.** The captions are already in the browser; pausing is just the page deciding
  not to scroll.
- The browser also sends a copy of each zone change to the server ("looked at the board 11 s here"), but only
  for the notes afterwards. If that copy is lost, pausing still works.

### 2. Where you look → whose voice you hear (Hard-of-Hearing mode)

- The tracker has a **forward-facing scene camera** (what the student sees). Your tracker also says *where in
  that camera image* the student is looking.
- The browser sends the camera frames and the room mic audio to the **look-to-hear engine**, another program
  on the same laptop (`127.0.0.1:7799`). The engine finds the faces and sends back their boxes.
- The browser checks which face box the gaze point is inside, holding it for about 0.6 s so glances don't
  switch. It tells the engine "focus on face 2", and the engine sends back that person's voice, isolated, for
  the earphones.
- **Again no server:** tracker → bridge → browser → engine → earphones, all on the laptop.

```
eye tracker ──► gaze bridge (ws://localhost:7777) ──► browser ──► captions pause / resume      (feature 1)
                                                         │
scene camera ──► browser ──frames + mic──► look-to-hear engine (127.0.0.1:7799)
gaze point in the camera image ──► browser picks the face ──► engine ──► that voice ──► earphones (feature 2)
```

## What you need to provide

| Signal | What it is | Used for |
| --- | --- | --- |
| Eye state | open / blink / lost | Ignoring blinks |
| Gaze on the screen | x, y on the laptop screen (0–1), or "not on screen" | `SCREEN` vs not |
| Gaze direction in the room | left/right and up/down angle, in degrees | `BOARD` vs `PERSON` vs `AWAY` |
| Gaze in the scene-camera image | x, y in the camera picture (0–1, top-left = 0,0) | Picking the face (feature 2) |
| Scene camera video | the forward camera, visible to the browser like a webcam (USB/UVC) | Faces + lips (feature 2) |
| Confidence | 0–1, per sample | Ignoring bad samples |

Three things to get right:
1. **The scene-camera gaze point must use the same picture the browser sees.** Same orientation, not mirrored,
   with (0,0) at the top-left. If the browser's video is flipped relative to your coordinates, the wrong face
   gets picked.
2. **Timestamps come from the laptop's clock, sent straight away.** The browser ignores gaze samples that are more
   than 0.3 s old or below 50% confidence.
3. **If the scene camera can't appear as a normal camera in Chrome**, tell Ashwath early. The browser needs it
   as a video source. Feature 1 works without any camera.

## Two ways to connect (pick one)

**A. Recommended: plug into our bridge.** You write one small adapter in Python that returns your latest
sample. Our bridge already does zones, blink handling, debouncing, calibration and the WebSocket. This is the
least work.

**B. Your own bridge.** If you already have your own server, it has to listen on `ws://localhost:7777` and send
and receive exactly the messages below. Everything else stays the same.

## How to check it works

1. `bun run live -- --gaze off` (everything except the gaze mock), then start your tracker + bridge.
2. Open the app and start a lecture in **Deaf** mode. Look up at the board: captions freeze. Look back: missed
   lines are highlighted and it catches up.
3. Switch to **Hard of hearing**, pick the tracker's camera as the scene camera, and look at a person: their
   face is highlighted and their voice is the one in the earphones.

---

## For your agent: the exact contracts

Repo: this monorepo. Do **not** change anything under `apps/server` or `apps/web` for this. The integration
point is the gaze bridge only.

### Option A: implement the tracker adapter (preferred)

File: [`apps/gaze-bridge/gaze_bridge/tracker.py`](../../apps/gaze-bridge/gaze_bridge/tracker.py). Implement a
`TrackerSource` and register it in `create_tracker()`; run `uv run gaze-bridge --tracker <name>`.

```python
@dataclass(frozen=True)
class TrackerSample:
    eye: str = "OPEN"                           # "OPEN" | "BLINK" | "LOST"
    screen: tuple[float, float] | None = None   # gaze on the laptop screen, 0..1, origin top-left; None if off-screen
    yaw: float | None = None                    # degrees, −90 (left) … +90 (right)
    pitch: float | None = None                  # degrees, + up / − down
    scene: tuple[float, float] | None = None    # gaze in the scene-camera image, 0..1, origin top-left
    confidence: float = 0.9                     # 0..1

class TrackerSource(Protocol):
    connected: bool
    def read(self) -> TrackerSample: ...        # called ~30×/s; must NOT block; return the latest estimate
    def close(self) -> None: ...
```

The bridge turns samples into zones with `zones.ZoneConfig` (screen margin 0.05; BOARD = pitch ≥ 5° and
|yaw| ≤ 30°; PERSON = within 15° of a known target; samples below confidence 0.4 → UNKNOWN). The calibration
"look at the board" step sets `board_pitch_deg`. `FakeTracker` in the same file is a working example.
`uv run pytest -q` in `apps/gaze-bridge` validates every emitted message against the contract.

### Option B: own bridge, the WebSocket protocol

Source of truth: [`packages/contracts/src/protocols/gaze-bridge.ts`](../../packages/contracts/src/protocols/gaze-bridge.ts)
(zod) and its JSON Schema copies `packages/contracts/json-schema/gaze-bridge.message.json` /
`gaze-bridge.command.json` (regenerate with `bun run contracts:json-schema`). Details:
[`docs/contracts/gaze-bridge.md`](../contracts/gaze-bridge.md).

- Server: `ws://localhost:7777`, JSON text frames, the browser is the client. Protocol version `"1"`.
- Timestamps (`ts`) are epoch milliseconds **from the laptop's own clock** (the browser drops `gaze.scene` samples
  older than 300 ms by comparing with its clock). Confidence is 0..1.

**Bridge → browser** (`GazeBridgeMessage`):

| type | fields | when |
| --- | --- | --- |
| `device.status` | `protocolVersion`, `tracker: CONNECTED\|DISCONNECTED`, `calibrated`, `audioFocus: ACTIVE\|IDLE\|UNAVAILABLE`, `mode: DEAF\|HARD_OF_HEARING`, `ts` | on connect and on any change |
| `gaze.zone` | `zone: SCREEN\|BOARD\|PERSON\|AWAY\|UNKNOWN`, `targetId` (string or null), `confidence`, `ts` | **feature 1**: on every change (debounced ~150 ms) + every 1 s |
| `gaze.scene` | `x`, `y` (0..1 in the scene image), `valid`, `confidence`, `ts` | **feature 2**: up to 30 Hz (15 Hz is fine) |
| `gaze.point` | `x`, `y` (0..1 on screen), `ts` | optional, only after `gaze.point.subscribe` and while on SCREEN |
| `gaze.targets` | `targets: [{ id, label, kind: TEACHER\|PEER\|UNKNOWN, azimuthDeg }]`, `ts` | optional, known people |
| `calibration.progress` | `step`, `totalSteps`, `instruction`, `target: {x,y}` or null (null = "look at the board"), `ts` | during calibration |
| `calibration.result` | `ok`, `quality`, `message`, `ts` | end of calibration |
| `error` | `code`, `message`, `ts` | problems |

**Browser → bridge** (`GazeBridgeCommand`): `hello {client, protocolVersion}` (sent on connect),
`calibration.start`, `calibration.confirm {step}`, `calibration.cancel`, `mode.set {mode}`,
`audio.focus.lock {targetId}`, `audio.focus.unlock`, `gaze.point.subscribe {enabled}`. `audio.focus` (bridge → web) is
reserved: the browser picks the voice itself.

### What the browser does with it (no changes needed; for reference)

- Zones → caption pause: [`apps/web/src/lib/live/gaze-pause.ts`](../../apps/web/src/lib/live/gaze-pause.ts)
  (connection: [`apps/web/src/hooks/use-gaze-bridge.ts`](../../apps/web/src/hooks/use-gaze-bridge.ts),
  `GazeProvider`). Each zone change is also forwarded to the server as
  [`GazeTransition`](../../packages/contracts/src/domain/gaze.ts) `{ from, to, targetId, ts }` on the session socket
  (fire-and-forget, for notes).
- `gaze.scene` → face: `createGazeTargetSelector` in
  [`packages/contracts/src/protocols/speaker-service.ts`](../../packages/contracts/src/protocols/speaker-service.ts)
  (ignores `valid: false`, confidence < 0.5 and samples older than 300 ms; 600 ms dwell; 0.04 hysteresis), driven
  by `startLookToHear()` in `@sightline/live-client`. The scene camera is chosen in the browser and remembered
  per browser (`apps/web/src/hooks/live/use-scene-camera.ts`).
- Calibration UI: the Setup page is still a placeholder (Sahil). It will send `calibration.start/confirm/cancel`
  and draw the dot from `calibration.progress.target`. Until then, calibrate from your own tool, or with the
  bridge defaults.

### Testing without the real UI

- `bun run mock:gaze` is the reference bridge in TypeScript (keys b / s / p / a); compare your messages to it.
- `bun run live -- --gaze off` runs everything else so your bridge can take port 7777.
