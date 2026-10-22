# Speaker service: "the voice you look at is the voice you hear"

**Owner:** Ashwath. This is a local, loopback-only Python service on the student's laptop. It takes the room's
**mixed microphone audio** plus **scene-camera video**, tracks the faces it sees, and, for the face the
student is looking at, extracts **that person's voice** using an audio-visual target-speaker model. It streams
the result back to the browser, which plays it into the earphones.

Protocol for the web app: [`docs/contracts/speaker-service.md`](../../docs/contracts/speaker-service.md) ·
TS schemas + client: `packages/contracts/src/protocols/speaker-service.ts`, `connectSpeakerService()`.

```
mic (mixed room audio, 16 kHz) ─┐
                                ├─► /live WebSocket ─► face tracking ─► target face's lip/face crops ─┐
scene camera frames (JPEG) ─────┘                                                                    │
                                                  gaze → "target" (face id) ──────────────────────────┤
                                                                                                     ▼
earphones ◄─ browser player (adaptive buffer) ◄─ "audio" packets ◄─ RTFS-Net / AV-MossFormer2 (+ RNNoise)
```

## Setup (once)

```sh
cd apps/speaker-service
uv sync --frozen                                   # Python 3.12 via uv
uv run python -m sightline_speaker.assets --dir data/assets   # RTFS-Net weights (~280 MB, SHA-256 pinned)
```

Or from the repo root: `bun run speaker:setup`.

## Run

```sh
uv run sightline-speaker --device auto             # ws://127.0.0.1:7799/live, GET /health
# or from the repo root: bun run speaker:dev
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--port` | `7799` | Always binds to 127.0.0.1 |
| `--origin` | `http://localhost:3001` | The exact web-app origin allowed (CORS + WebSocket origin check) |
| `--device` | `auto` | `auto`/`mps` on Apple Silicon = visual encoder on MPS, audio model on CPU (`mps-video/cpu-audio`); `cpu` everywhere else |
| `--engine` | `rtfs` | `rtfs` (RTFS-Net, 12 M params, default) or `av-mossformer2` (68 M params, larger and slower; needs its own assets) |
| `--noise` | `auto` | RNNoise post-filter. `auto` uses it where the native wheel exists (Linux, Windows, macOS 26+), else passthrough. Reported as `noise_processor` in `/health` |
| `--assets` / `--data-dir` | `data/assets` / `data/sessions` | `data/` is git-ignored |

`GET /health` reports real readiness: `model_state`, `device`, `streaming_ready` (after shape warm-up),
`noise_processor`. Missing or unverified weights leave the service **unready**. It never passes the mixed
audio through and calls it focused.

Optional larger engine:

```sh
uv run python -m sightline_speaker.assets --engine av-mossformer2 --dir data/av-assets
uv run sightline-speaker --engine av-mossformer2 --assets data/av-assets --device auto
```

## How it works

1. **Configure.** The browser opens `/live` and sends `configure` (16 kHz, source `camera` | `network` | `replay`,
   a verified A/V sync offset). The service answers `ready` with the device, engine and warm timings.
2. **Faces.** Binary *kind 2* packets carry JPEG scene frames stamped with the audio sample index they line up
   with. MediaPipe Face Landmarker tracks faces with session-local ids. The service sends `faces` (~5 Hz) with
   normalised boxes.
3. **Target.** The browser decides which face the student is looking at (gaze point inside a face box, held
   for a dwell time, with hysteresis) and sends `target { generation, target_id }`. Each switch bumps the
   `generation`, so stale results for the previous person are dropped on both sides.
4. **Audio.** Binary *kind 1* packets carry ≤ 200 ms of float32 mono PCM. The service keeps a 400 ms history,
   runs the model on whatever new audio is available (minimum 120 ms, shapes padded to 200 ms steps and
   pre-warmed), and overlap-adds the results. It then sends `audio` replies (base64 float32 PCM, source sample
   index, capture spans, timings).
5. **Safety.** Losing the selected face pauses and asks for reselection; it never silently switches to another
   face. If processing can't keep up, the service sends `flow: pause` and drains, and never plays stale audio as
   current. `end` drains the tail and replies `drained`.

Binary packet header (little-endian, 32 bytes): `magic "GSP2" | kind u8 | 3 pad | generation u32 |
source sample_start u64 | capture_time f64 (s) | payload_length u32`, followed by the payload.

File mode (`POST /clips` → `/clips/{id}/extract` → `/jobs/{id}/audio`) processes an uploaded video offline. It's
useful for demos and evaluation.

## Measured on an M1 Pro (16 GB), RTFS engine, `mps-video/cpu-audio`

| Check | Result |
| --- | --- |
| Unit tests | 166 passed, 6 skipped (model/native-gated) |
| Real-model tests (`SPEAKER_MODEL_TESTS=1 uv run pytest -m model`) | pass |
| Two-speaker overlap (GRID samples, `python -m sightline_speaker.evaluation`) | SI-SDR improvement **+16.4 dB** (female target), **+1.2 dB** (male target) |
| Live paced replay, both targets (`streaming_reference --automatic-faces --gaze x,y`) | complete, no dropped samples; inference median ≈ 0.54 s per step; send → focused-audio p95 ≈ 1.2–1.4 s |
| Target conditioning | left vs right focused outputs correlate 0.27, so the voices are distinct, not a volume change |

Quality is uneven: some overlap leakage remains, and the model is non-causal, so this is about 1 s of
latency, not hearing-aid latency. Treat the numbers above as measured, not guaranteed.

## Evaluate / benchmark yourself

```sh
# two public GRID sample clips → data/evaluation/sources/grid-{male,female}.mpg (URLs in sightline_speaker/evaluation.py)
uv run python -m sightline_speaker.evaluation
uv run sightline-speaker --device auto &          # then, live replay with a simulated gaze point:
uv run python -m sightline_speaker.streaming_reference --input data/evaluation/grid-overlap-degraded.mov \
  --output data/benchmarks/live-left --automatic-faces --gaze 0.25,0.6
SPEAKER_MODEL_TESTS=1 uv run pytest
```

## Licenses

Model code under `third_party/` keeps its upstream licenses and notices: RTFS-Net (MIT, plus Asteroid MIT),
AV-MossFormer2 / ClearerVoice-Studio (Apache-2.0), and RNNoise (BSD-style). The face model is in `models/`
(Apache-2.0). Checkpoints are downloaded by the setup command and are never committed.
