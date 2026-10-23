# Speaker service protocol: look-to-hear (web ↔ local service)

> Owner: **Ashwath**. Service internals, setup and measured results: [`apps/speaker-service/README.md`](../../apps/speaker-service/README.md).

**Source of truth:** [`packages/contracts/src/protocols/speaker-service.ts`](../../packages/contracts/src/protocols/speaker-service.ts)
· Client: `connectSpeakerService()` from `@sightline/contracts/client` · Mock: `bun run mock:speaker`

```
WebSocket:  ws://127.0.0.1:7799/live        (NEXT_PUBLIC_SPEAKER_SERVICE_URL)
Health:     GET http://127.0.0.1:7799/health
Loopback only; the browser Origin must equal the configured web origin (default http://localhost:3001).
One live session at a time (a second tab gets `live_busy`).
Field names are snake_case because they mirror the Python wire format.
```

## Hard-of-hearing mode, end to end

```
 scene camera ──JPEG frames (kind 2)──┐
 room mic ─────PCM 16 kHz (kind 1)────┼──► speaker service ──faces──► web
 gaze bridge ──gaze.scene {x,y}──► web: createGazeTargetSelector(gaze, faces)
                                        └─► target {generation, target_id} ──► service
 earphones ◄── web audio player ◄──────────── audio {start_sample, pcm} ◄── service (AV-MossFormer2)
```

1. Connect; the client sends `configure` automatically. Wait for `ready` (seed the playback buffer from `warm_timings`).
2. Stream scene frames as kind-2 packets (sample index = the audio sample they line up with). The service
   answers `faces` about 5 times a second.
3. Focus a person confirms fresh calibrated scene gaze with voice or a button, or clicks a face box. Send
   `target` with `generation + 1` and keep that ID selected when gaze moves. On verified loss, send `null`
   and ask for reselection. The older dwell selector remains available to other clients.
4. Stream mic audio as kind-1 packets (≤ 3200 float32 samples each, contiguous `sample_start`).
5. Play each `audio` reply at its `start_sample` through an adaptive jitter buffer, and drop anything whose
   `generation` isn't current. Default AV-MossFormer2 uses three-second windows and a 1.8-second stride:
   initial output needs three seconds of input plus processing and playback buffering. Check actual timings
   on the target laptop; old RTFS latency measurements do not apply. Never play a source sample twice.
6. Stop: send `end { source_end_sample }`, wait for `drained`, then `stop`.

## Web → service

| Frame | Fields | Notes |
| --- | --- | --- |
| `configure` (JSON) | `protocol_version: 3, sample_rate: 16000, audio: true, source: camera\|network\|replay, sync_verified: true, video_offset_ms, client_time` | First frame, within 5 s |
| `target` | `generation` (must increase), `target_id \| null` | Each switch discards older results |
| `region` | `box \| null` | Manual correction: detect only inside this box (exactly one face) |
| `pause` / `resume` / `heartbeat` | – | Heartbeat at least every 5 s when idle |
| `end` | `source_end_sample` | Drain accepted audio, then the service sends `drained` |
| `stop` | – | Close |
| binary kind 1 | 32-byte header + ≤ 200 ms float32 LE PCM | `encodeSpeakerPcm(generation, sampleStart, captureTime, pcm)` |
| binary kind 2 | 32-byte header + JPEG | `encodeSpeakerPacket(SpeakerPacketKind.FRAME, …)` |

Header: `"GSP2" | kind u8 | 3 pad | generation u32 | sample_start u64 | capture_time f64 | length u32` (little-endian).
Capture time must never go backwards. Audio `sample_start` must be contiguous. Frames must stay within 150 ms of the audio.

## Service → web

| `type` | Fields | Meaning |
| --- | --- | --- |
| `ready` | `device, engine, noise_processor, warm_timings, minimum_samples, …` | Model warmed and accepting input |
| `faces` | `tracks: [{ id, manual, observations: [{ timestamp, box: [x,y,w,h] }] }]` | Session-local face ids (not recognition) |
| `selected` | `target_id` | Target change acknowledged |
| `audio` | `start_sample, sample_count, pcm (base64 f32), capture_spans, timings, queued_windows` | Focused voice; decode with `decodeSpeakerPcm` |
| `flow` | `action: pause\|resume, reason` | The device can't keep up: input stops and accepted audio drains |
| `drained` | `source_end_sample` | All accepted audio delivered |
| `error` | `code, message` | `synchronization_or_target_lost` → reselect. Also `live_busy`, `model_unready`, `streaming_unready`, `invalid_live_input` |

## Guarantees worth designing the UI around

- The service never returns the unprocessed mixture as "focused". If it can't separate, it says so (`error` / unready).
- Losing the selected face pauses output. It never jumps to another face on its own.
- Show the student which face is selected (box overlay) and the measured delay.
