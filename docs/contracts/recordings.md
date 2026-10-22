# Session recordings (web ↔ server ↔ storage)

> **Recorder (browser): Sahil.** Server API + storage: scaffolded by Ashwath; **owner TBD**.
> Source of truth: [`packages/contracts/src/domain/recordings.ts`](../../packages/contracts/src/domain/recordings.ts),
> routes in [`api.ts`](../../packages/contracts/src/api.ts), helper `createRecordingUploader` in `@sightline/contracts/client`.

## What and why

The student can re-watch the lecture later: what the **eye tracker's scene camera** saw (or the webcam/screen) plus the
room audio, next to the captions and notes. Recordings are uploaded in segments straight to storage
(S3 / R2 / MinIO in prod, the local dev store otherwise) using **presigned URLs**, so video never passes through the
API server.

## Flow

```
web (MediaRecorder)                    server                               storage (S3 / local)
  │ POST /recordings {source, contentType} ──► Recording {id, RECORDING}
  │ every ~5 min: stop+restart recorder → one self-contained file per segment
  │ POST /recordings/:id/segments {index, size, startMs, durationMs}
  │                          ◄── { segment PENDING, upload: {url, method: PUT, headers} }
  │ PUT upload.url (blob, headers) ─────────────────────────────────────────────► object
  │ POST /recordings/:id/segments/:index/complete ──► verifies object exists ──► segment UPLOADED
  │ ... repeat per segment ...
  │ POST /recordings/:id/finish ─────────────► READY (or FAILED if nothing uploaded)
  │ GET /recordings ◄── segments with fresh presigned playback URLs (≈1 h)
```

`createRecordingUploader(api, sessionId)` does every server call for you, keeps segments ordered and retries failures.
You only produce blobs:

```ts
import { createRecordingUploader, createSightlineApi } from "@sightline/contracts/client";

const api = createSightlineApi({ baseUrl: process.env.NEXT_PUBLIC_SERVER_URL! });
const uploader = await createRecordingUploader(api, sessionId, { source: "SCENE_CAMERA", contentType: "video/webm" });

const stream = new MediaStream([...sceneVideoStream.getVideoTracks(), ...micStream.getAudioTracks()]);
const sessionStartedAt = session.startedAt!;
let recorder: MediaRecorder, chunkStart = 0;

function startSegment() {
  chunkStart = Date.now();
  recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 1_000_000 });
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => parts.push(e.data);
  recorder.onstop = () =>
    uploader.addSegment(new Blob(parts, { type: "video/webm" }), {
      startMs: chunkStart - sessionStartedAt,
      durationMs: Date.now() - chunkStart,
    });
  recorder.start();
}
startSegment();
const rotate = setInterval(() => { recorder.stop(); startSegment(); }, 5 * 60_000); // self-contained 5-min files

// on "End lecture":
clearInterval(rotate); recorder.stop(); await uploader.finish();
```

## Rules

- Segment = one complete, playable file (restart `MediaRecorder` per segment; timeslice chunks are not playable alone).
- `contentType`: `video/webm` (Chrome/Firefox) or `video/mp4` (Safari). ≤ 1 GiB per segment.
- `startMs` = offset from the session's `startedAt`, so playback can seek the transcript to the same moment
  (`CaptionSegment.startMs`).
- Recordings can only be created while the session is LIVE. Upload URLs expire after `STORAGE_URL_TTL_SECONDS`.
- Playback: play `segments[]` in order (each has its own `url`). Re-fetch `GET /recordings` if a URL has expired.
- Privacy: recordings capture classmates. Keep the UI explicit ("● Recording") and let the student stop it anytime.

## Endpoints

| Method | Path | Body | → |
| --- | --- | --- | --- |
| POST | `/api/sessions/:id/recordings` | `{ source?, contentType? }` | `201 Recording` |
| POST | `/api/sessions/:id/recordings/:recordingId/segments` | `{ index, contentType, sizeBytes, startMs, durationMs }` | `201 { segment, upload }` |
| PUT | `upload.url` (storage, not our API) | raw bytes, `upload.headers` | `200` |
| POST | `/api/sessions/:id/recordings/:recordingId/segments/:index/complete` | – | `RecordingSegment` (409 if bytes missing) |
| POST | `/api/sessions/:id/recordings/:recordingId/finish` | – | `Recording` |
| GET | `/api/sessions/:id/recordings` | – | `{ data: Recording[] }` |
