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
earphones ◄─ browser player (adaptive buffer) ◄─ "audio" packets ◄─ AV-MossFormer2 (+ RNNoise)
```

## Setup (once)

```sh
cd apps/speaker-service
uv sync --frozen                                   # Python 3.12 via uv
uv run python -m sightline_speaker.assets           # AV-MossFormer2, SHA-256 pinned, data/av-assets
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
| `--origin` | `http://localhost:3001` | The exact web-app origin allowed (CORS + WebSocket origin check): `http://localhost:<port>` in dev, `https://<domain>` for the deployed web app |
| `--device` | `auto` | AV runs on MPS on supported Apple Silicon, CPU elsewhere. Explicit `mps` fails if unavailable. RTFS uses `mps-video/cpu-audio` on Apple Silicon. |
| `--engine` | `av-mossformer2` | AV-MossFormer2-TSE-16K (68.5 M params). `rtfs` remains an explicit alternative. Neither silently falls back to the other engine. |
| `--noise` | `auto` | RNNoise post-filter. `auto` uses it where the native wheel exists (Linux, Windows, macOS 26+), else passthrough. Reported as `noise_processor` in `/health` |
| `--assets` / `--data-dir` | `data/av-assets` / `data/sessions` | Assets follow the selected engine; explicit RTFS uses `data/assets`. `data/` is git-ignored. |

`GET /health` reports real readiness: `model_state`, `device`, `streaming_ready` (after shape warm-up),
`noise_processor`. Missing or unverified weights leave the service **unready**. It never passes the mixed
audio through and calls it focused.

Explicit legacy RTFS engine:

```sh
uv run python -m sightline_speaker.assets --engine rtfs
uv run sightline-speaker --engine rtfs --device auto
```

## How it works

1. **Configure.** The browser opens `/live` and sends `configure` (16 kHz, source `camera` | `network` | `replay`,
   a verified A/V sync offset). The service answers `ready` with the device, engine and warm timings.
2. **Faces.** Binary *kind 2* packets carry JPEG scene frames stamped with the audio sample index they line up
   with. MediaPipe Face Landmarker tracks faces with session-local ids. The service sends `faces` (~5 Hz) with
   normalised boxes.
3. **Target.** In Focus a person, the student looks inside a face box and confirms with voice or a button,
   or clicks a face. The target stays locked when gaze moves. Each switch sends an increasing
   `target { generation, target_id }`, so previous results and buffered microphone audio are discarded.
4. **Audio.** Binary *kind 1* packets carry ≤ 200 ms of float32 mono PCM. AV uses three-second windows
   with a 1.8-second stride and 1.2-second overlap. Overlap-add emits each source sample once. Playback also
   rejects duplicate samples. The service sends `audio` replies with base64 float32 PCM, source positions,
   capture spans and timings. Initial output needs three seconds of aligned input plus processing and
   playback buffering; this is not hearing-aid latency. Explicit RTFS retains its legacy available-input mode
   (minimum 120 ms, 400 ms history).
5. **Continuity.** Motion is updated on every incoming frame, with balanced upper-face features for small
   faces. Weak motion evidence requires a fresh face fit supported by matched texture and tracked facial
   landmarks. An unsupported wide-frame fit can retry a real face crop instead of dropping the ID during a
   head turn. Stronger image flow can bridge a missing fit for at most 600 ms, without inventing mouth
   observations or renewing the deadline. Ambiguous overlaps and newcomers do not inherit the selected ID.
   Unverified loss pauses for reselection.
   This is short-term image continuity, not biometric recognition. The browser samples fresh decoded frames
   at up to 25 fps; frozen or missing frames are never duplicated to simulate lip movement. Video coverage
   must stay within 150 ms of the microphone timeline. Network frame drops can still pause separation.
6. **Capacity.** If processing cannot keep up, the service sends `flow: pause` and drains. `end` drains the
   tail and replies `drained`. No mixed-audio fallback is played as focused speech.

Binary packet header (little-endian, 32 bytes): `magic "GSP2" | kind u8 | 3 pad | generation u32 |
source sample_start u64 | capture_time f64 (s) | payload_length u32`, followed by the payload.

File mode (`POST /clips` → `/clips/{id}/extract` → `/jobs/{id}/audio`) processes an uploaded video offline. It's
useful for demos and evaluation.

## Historical RTFS measurements (not AV-MossFormer2 results)

| Check | Result |
| --- | --- |
| Two-speaker overlap (GRID samples, `python -m sightline_speaker.evaluation`) | SI-SDR improvement **+16.4 dB** (female target), **+1.2 dB** (male target) |
| Live paced replay, both targets (`streaming_reference --automatic-faces --gaze x,y`) | complete, no dropped samples; inference median ≈ 0.54 s per step; send → focused-audio p95 ≈ 1.2–1.4 s |
| Target conditioning | left vs right focused outputs correlate 0.27, so the voices are distinct, not a volume change |

These earlier RTFS measurements used two short GRID clips and do not establish AV-MossFormer2 quality
or latency. Separation can still leak other voices, especially with blurred/small lips or incorrect A/V sync.
Changing the default does not guarantee isolation when the selected face is out of view.

## Evaluate / benchmark yourself

```sh
# Historical offline RTFS harness; needs explicitly installed RTFS assets and the two GRID source clips
# in data/evaluation/sources/grid-{male,female}.mpg (URLs in sightline_speaker/evaluation.py).
uv run python -m sightline_speaker.evaluation --assets data/assets
# Test the currently running engine (AV by default) through the actual live WebSocket path:
uv run sightline-speaker --device auto &          # then, live replay with a simulated gaze point:
uv run python -m sightline_speaker.streaming_reference --input data/evaluation/grid-overlap-degraded.mov \
  --output data/benchmarks/live-left --origin http://localhost:3001 \
  --url ws://127.0.0.1:7799/live --automatic-faces --gaze 0.25,0.6
SPEAKER_AV_MODEL_TESTS=1 uv run pytest -q tests/test_av_model.py
```

On 2026-10-23 the real AV live WebSocket path, with automatic face detection, processed the two
three-second degraded GRID targets without target loss or missing/duplicated samples (48,000 in and out
for each selection). SI-SDR improvement was +13.6 dB and +14.0 dB; per-target output correlation was 0.006.
Arrival delay p95 was 4.5–4.6 seconds before browser playback buffering. These are two short examples,
not evidence of accuracy on a moving ESP camera or a general isolation guarantee. Generated reports are
under ignored `data/benchmarks/av-live-{left,right}/` and `data/benchmarks/av-live-quality.json`.

The same real live path completed a 31.936-second, 320×180/15 fps three-person reference with automatic
face selection and JPEG quality 70: no target loss, no flow pauses, and 510,976 accepted/output samples.
Inference median was 1.53 seconds and arrival delay p95 was 4.73 seconds before browser buffering. This
clip has no clean stems, so it measures continuity and timing, not separation accuracy. The generated report
is `data/benchmarks/av-live-debate-right/report.json`. The regular Python suite passed 185 tests with six
opt-in checks skipped; the actual AV checkpoint and real recording were verified separately.

## Licenses

Model code under `third_party/` keeps its upstream licenses and notices: RTFS-Net (MIT, plus Asteroid MIT),
AV-MossFormer2 / ClearerVoice-Studio (Apache-2.0), and RNNoise (BSD-style). The face model is in `models/`
(Apache-2.0). Checkpoints are downloaded by the setup command and are never committed.
