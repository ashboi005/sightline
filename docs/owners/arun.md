# Arun — Eye Tracker, Gaze Bridge & Gaze-Directed Voice Isolation

> Back to [overview](../00-overview.md). Your protocol: [contracts/gaze-bridge.md](../contracts/gaze-bridge.md).

## Mission

Turn our custom eye tracker into two things the rest of the system can use:

1. **Gaze zones** — is the student looking at the laptop `SCREEN`, the `BOARD`, a specific `PERSON`, or `AWAY`?
   This drives the Deaf-mode caption pause/bookmark/catch-up (module 2).
2. **Voice isolation** — in Hard-of-Hearing mode, isolate the voice of whoever the student is looking at and
   play only that into their earphones, switching when their gaze moves (module 1).

## You own

| Thing | Where |
| --- | --- |
| Eye tracker hardware + firmware | your hardware repo / `apps/gaze-bridge/firmware/` if you want it here |
| Gaze bridge daemon (Python, local) | [`apps/gaze-bridge/`](../../apps/gaze-bridge) — skeleton already speaks the protocol |
| Calibration (screen corners + "look at the board") | bridge |
| Mapping gaze → zone / person target | bridge |
| Voice isolation (mic array / beamforming / source separation) → earphones | bridge |

## You do NOT own

- Any UI (Sahil draws calibration dots, zone indicator, focus target from your messages).
- Captions/transcription (Tushar), anything LLM (Ashwath).
- The server — your bridge talks **only to the browser**, locally.

## What you produce (your contract)

A WebSocket server on `ws://localhost:7777` that emits `device.status`, `gaze.zone`, `gaze.targets`,
`audio.focus`, `calibration.*` and accepts `hello`, `calibration.*`, `mode.set`, `audio.focus.*`,
`gaze.point.subscribe`. Exact fields: [contracts/gaze-bridge.md](../contracts/gaze-bridge.md); JSON Schemas for
Python validation/codegen: `packages/contracts/json-schema/gaze-bridge.*.json`.

Hard requirements:

- `gaze.zone` within **~150 ms** of a real change (debounced so blinks don't flicker) + 1 Hz heartbeat.
- Blinks / lost eyes → `UNKNOWN`, never a false `SCREEN`/`BOARD` flip.
- `mode.set HARD_OF_HEARING` enables audio focus; `DEAF` disables it (zones still stream).

## What you consume

Nothing from the team at runtime. The web app connects to you.

## How you work without anyone else

```bash
cd apps/gaze-bridge && python -m venv .venv && . .venv/bin/activate && pip install -e .
gaze-bridge                       # skeleton with FakeTracker — replace FakeTracker / AudioFocus
```

- Test with a raw client: `bunx wscat -c ws://localhost:7777` and type `{"type":"mode.set","mode":"HARD_OF_HEARING"}`.
- Or run the web app (`bun run dev:web`) — Sahil's UI will consume your socket exactly like the mock.
- To see the expected behaviour first: `bun run mock:gaze` is the reference implementation (TypeScript).

## Suggested plan

1. Replace `FakeTracker.read()` with real tracker output → zone classification (screen rectangle from
   calibration; "above the screen" = BOARD).
2. Calibration flow: 4 screen corners + 1 board fixation → `calibration.result.quality`.
3. Person targets: map gaze azimuth to known speakers (`gaze.targets` with `azimuthDeg`).
4. Voice isolation: beamform the mic array toward the focused target's azimuth (or source-separate and pick
   the matching source) → earphones. Publish `audio.focus` on every switch.
5. Stretch: expose the isolated audio stream so it can also feed captions (talk to Tushar first).

## Done when

- [ ] Web app pauses/resumes captions from your real tracker (integration checkpoint **M1**)
- [ ] Calibration works end-to-end with Sahil's UI
- [ ] HoH mode: looking at speaker A vs B audibly switches the earphone audio
- [ ] Unplugging the tracker sends `device.status { tracker: "DISCONNECTED" }`
