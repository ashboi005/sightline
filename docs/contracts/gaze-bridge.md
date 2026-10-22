# Gaze bridge protocol (local gaze / audio-focus daemon ↔ web)

> Bridge software + voice isolation: **Ashwath**. Tracker hardware + gaze estimation feeding it: **Arunya**.

**Source of truth:** [`packages/contracts/src/protocols/gaze-bridge.ts`](../../packages/contracts/src/protocols/gaze-bridge.ts)
· JSON Schema: `packages/contracts/json-schema/gaze-bridge.{message,command}.json`
· Python skeleton: [`apps/gaze-bridge/gaze_bridge/server.py`](../../apps/gaze-bridge/gaze_bridge/server.py)
· Mock: `bun run mock:gaze`

```
The bridge is the WebSocket SERVER:   ws://localhost:7777   (NEXT_PUBLIC_GAZE_BRIDGE_URL)
The browser connects as a client and sends "hello" on every (re)connect.
All frames are JSON text. Protocol version: "1".
```

## Zones

| zone | meaning | web app reaction (Deaf mode) |
| --- | --- | --- |
| `SCREEN` | eyes on the laptop | live auto-scroll; if returning from away → show missed block, then resume |
| `BOARD` | front of the room (board/teacher) | pause scroll, bookmark, highlight new captions |
| `PERSON` | a specific person (`targetId`) | same as BOARD; in HoH mode drives audio focus |
| `AWAY` | anywhere else | same as BOARD |
| `UNKNOWN` | blink / lost tracking | **ignore** (no state change) |

## Bridge → web

| type | fields | rules |
| --- | --- | --- |
| `device.status` | `protocolVersion, tracker: CONNECTED\|DISCONNECTED, calibrated, audioFocus: ACTIVE\|IDLE\|UNAVAILABLE, mode` | On connect + whenever any field changes |
| `gaze.zone` | `zone, targetId, confidence, ts` | Immediately on change (debounced ~150 ms) **and** 1 Hz heartbeat |
| `gaze.targets` | `targets: [{ id, label, kind: TEACHER\|PEER\|UNKNOWN, azimuthDeg }]` | On connect + when people appear/disappear |
| `gaze.scene` | `x, y` (0..1 in the **scene camera** image), `valid, confidence` | ≤ 30 Hz while the tracker has a scene estimate. Feeds `createGazeTargetSelector` → [speaker service](speaker-service.md) |
| `audio.focus` | `targetId, label, locked` | *Reserved*: with the speaker service, the web app owns target selection |
| `gaze.point` | `x, y` (0..1, top-left origin) | Only for subscribed clients, zone SCREEN, ≤ 30 Hz |
| `calibration.progress` | `step, totalSteps, instruction, target: {x,y} \| null` | During calibration; `target: null` = "look at the board" step |
| `calibration.result` | `ok, quality, message` | End of calibration |
| `error` | `code, message` | |

## Web → bridge

| type | fields | effect |
| --- | --- | --- |
| `hello` | `client, protocolVersion` | Bridge answers with `device.status` |
| `calibration.start` | – | Start calibration |
| `calibration.confirm` | `step` | Student confirms fixation (space/click) — optional, bridge may auto-advance |
| `calibration.cancel` | – | Abort → `calibration.result { ok: false }` |
| `mode.set` | `mode: HARD_OF_HEARING \| DEAF` | Audio focus runs only in HARD_OF_HEARING |
| `audio.focus.lock` | `targetId` | Keep isolating this voice regardless of gaze |
| `audio.focus.unlock` | – | Back to gaze-driven focus |
| `gaze.point.subscribe` | `enabled` | Toggle `gaze.point` stream |

## Example session

```jsonc
// ← bridge
{"type":"device.status","protocolVersion":"1","tracker":"CONNECTED","calibrated":false,"audioFocus":"IDLE","mode":"DEAF","ts":1761123450000}
{"type":"gaze.targets","targets":[{"id":"teacher","label":"Teacher","kind":"TEACHER","azimuthDeg":0}],"ts":1761123450001}
{"type":"gaze.zone","zone":"SCREEN","targetId":null,"confidence":0.95,"ts":1761123450002}
// → web
{"type":"mode.set","mode":"HARD_OF_HEARING"}
// ← bridge (student looks at a classmate)
{"type":"gaze.zone","zone":"PERSON","targetId":"peer_left","confidence":0.9,"ts":1761123461000}
{"type":"audio.focus","targetId":"peer_left","label":"Classmate (left)","locked":false,"ts":1761123461001}
```
