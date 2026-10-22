# Frontend API contract — everything `apps/web` talks to

> For **Sahil** (and anyone wiring a screen). One page that lists **every** API the web app uses: the server's REST
> + auth + WebSocket, direct-to-S3 media, and the three services on the student's laptop. Each row points at the
> zod schema that is the source of truth, the typed client call, and where it is already wired in `apps/web`.
> Back to [overview](../00-overview.md) · deep dives: [session socket](realtime-ws.md) · [recordings](recordings.md) ·
> [gaze bridge](gaze-bridge.md) · [sign service](sign-service.md) · [speaker service](speaker-service.md) ·
> [mock mode](mock-mode.md).

**Rules**

- Never hand-write a type: import it from `@sightline/contracts` (shapes) and `@sightline/contracts/client` (callers).
  The client validates every response against its schema and warns in the console when the server drifts.
- If a screen needs something that isn't here, add it to `packages/contracts` (additive, optional field) and ping the
  owner: **Ashwath** (live, captions, sign, snapshots, recordings, storage) or **Tushar** (sessions, context, slides, notes).
- JSON Schema copies for non-TS tools: `bun run contracts:json-schema` → `packages/contracts/json-schema/`.
- `bun run --filter server smoke` (mock server) calls every endpoint and validates every response against these schemas.

## 0. Map

```
Browser (apps/web)
 ├─ HTTPS ─► server /api/auth/*           better-auth             §1   authClient            (lib/auth-client.ts)
 ├─ HTTPS ─► server /api/*                REST                    §2   createSightlineApi()  (lib/api.ts → api.*)
 ├─ WSS   ─► server /ws/sessions/:id      live session socket     §3   connectSessionSocket()
 ├─ HTTPS ─► S3 (presigned)               recording PUT/GET,      §4   createRecordingUploader(), <img>/<audio>/<video>
 │                                        asset GET (via 302)
 ├─ WS    ─► localhost:7777               gaze bridge             §5   connectGazeBridge()
 ├─ WS    ─► localhost:7788/ws            sign service            §5   connectSignService()
 └─ WS    ─► 127.0.0.1:7799/live          speaker (look → hear)   §5   startLookToHear()     (@sightline/live-client)
```

The server never talks to the laptop services and the laptop services never talk to the server: **the browser is
the only hub**. Example: gaze-pause is decided entirely in the browser (§5.1); the server only receives a copy of
each zone change for the notes.

### Environment (`apps/web/.env`, read in `src/lib/config.ts`)

| Variable | Local | Production |
| --- | --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:3000` | `https://api.<domain>` |
| `NEXT_PUBLIC_SERVER_WS_URL` | `ws://localhost:3000` | `wss://api.<domain>` |
| `NEXT_PUBLIC_GAZE_BRIDGE_URL` | `ws://localhost:7777` | same (runs on the student laptop) |
| `NEXT_PUBLIC_SIGN_SERVICE_URL` | `ws://localhost:7788/ws` | same |
| `NEXT_PUBLIC_SPEAKER_SERVICE_URL` | `ws://127.0.0.1:7799/live` (health: `http://127.0.0.1:7799/health`) | same |

## Conventions (all server APIs)

| | |
| --- | --- |
| Auth | better-auth session cookie. Every call uses `credentials: "include"` (the typed client already does). `401` → send the user to `/sign-in`. With `MOCK_AUTH=true` every call is the demo user |
| IDs | Prefixed strings: `ses_`, `seg_`, `sld_`, `trm_`, `tok_`, `utt_`, `snp_`, `rec_`, `nts_`, `ast_` ([common.ts](../../packages/contracts/src/domain/common.ts#L12)) |
| Time | `Timestamp` = epoch ms. `OffsetMs` = ms since the session started (captions, snapshots, recording segments) |
| Long work | Context, slides and notes run in the background: the call returns `202` + `PROCESSING`; then poll the GET **or** react to socket events (§3). Statuses: `EMPTY → PROCESSING → READY \| FAILED` |
| Errors | Always [`ApiError`](../../packages/contracts/src/domain/common.ts#L35) `{ error: { code, message, details? } }`; the client throws `ApiRequestError` (`.status`, `.body`). `lib/api.ts → errorMessage()` turns it into a sentence |

| `error.code` | HTTP | Typical cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 (400 for malformed JSON) | Body/query/multipart field fails the schema; wrong file type/size |
| `UNAUTHORIZED` | 401 | No/expired cookie |
| `NOT_FOUND` | 404 | Unknown id **or someone else's session** (never 403, so ids don't leak) |
| `CONFLICT` | 409 | Wrong state: start an ENDED session, end a non-LIVE one, notes before end, recording while not LIVE, completing a segment that wasn't uploaded |
| `UPSTREAM_ERROR` | 502 | A provider (LLM, STT, TTS, S3) failed |
| `NOT_IMPLEMENTED` | 501 | A module is switched to a stub (only in partial mock setups) |
| `INTERNAL` | 500 | Bug: report it with the request |

## 1. Auth — better-auth (`/api/auth/*`)

Client: `authClient` from [`lib/auth-client.ts`](../../apps/web/src/lib/auth-client.ts), wrapped by
[`hooks/use-auth.ts`](../../apps/web/src/hooks/use-auth.ts). Implemented by `packages/auth` (server: `apps/server/src/index.ts`).

| Call | HTTP | Body | Result |
| --- | --- | --- | --- |
| `authClient.signUp.email` | `POST /api/auth/sign-up/email` | `{ name, email, password }` | user + session cookie; `422` duplicate email |
| `authClient.signIn.email` | `POST /api/auth/sign-in/email` | `{ email, password }` | session cookie; `401` wrong password |
| `authClient.signOut` | `POST /api/auth/sign-out` | `{}` | cookie revoked server-side (an old copy gets `401`) |
| `authClient.getSession` | `GET /api/auth/get-session` | – | `{ user, session }` or `null` |
| `api.me()` | `GET /api/me` | – | [`CurrentUser`](../../packages/contracts/src/domain/session.ts#L50) `{ id, name, email, isMock }` |

Cookie: local http → `SameSite=Lax`, host-only. Production https → `__Secure-…; Secure; SameSite=None` with
`Domain=<AUTH_COOKIE_DOMAIN>` so server components on the web domain see it too. The session socket (§3) and asset
URLs (§4) authenticate with the same cookie — no tokens to pass around.

## 2. REST (`/api/*`)

Route table (source of truth): [`packages/contracts/src/api.ts`](../../packages/contracts/src/api.ts) — `routes.<name>`.
Typed client: [`createSightlineApi()`](../../packages/contracts/src/client/http.ts#L35) → `api.<name>(…)` in `lib/api.ts`.
Schemas live in [`src/domain/`](../../packages/contracts/src/domain). "Wired in" = where `apps/web` calls it today.

### 2.1 System & sessions

| Method & path | Client call | Request | Response | Errors | Wired in |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health` | `api.health()` | – | `200` [`HealthResponse`](../../packages/contracts/src/domain/session.ts#L58) (which modules are mocked) | – | `use-lecture-data.ts` |
| `GET /api/me` | `api.me()` | – | `200` [`CurrentUser`](../../packages/contracts/src/domain/session.ts#L50) | 401 | `use-auth.ts` |
| `GET /api/sessions?page&pageSize` | `api.listSessions(page, pageSize)` | [`PaginationQuery`](../../packages/contracts/src/domain/common.ts#L44) | `200` `{ data: Session[], pagination }` ([`Pagination`](../../packages/contracts/src/domain/common.ts#L50)), newest first | 401 | `use-sessions.ts` |
| `POST /api/sessions` | `api.createSession(body)` | [`CreateSessionInput`](../../packages/contracts/src/domain/session.ts#L32) `{ title, subject?, mode?, contextText? }` | `201` [`Session`](../../packages/contracts/src/domain/session.ts#L17) (`DRAFT`; `contextStatus: PROCESSING` if `contextText`) | 422 | `use-sessions.ts` |
| `GET /api/sessions/:id` | `api.getSession(id)` | – | `200` `Session` | 404 | `use-sessions.ts`, `live-lecture-provider.tsx` |
| `PATCH /api/sessions/:id` | `api.updateSession(id, body)` | [`UpdateSessionInput`](../../packages/contracts/src/domain/session.ts#L41) (any of `title`, `subject`, `mode`; mode may change while LIVE) | `200` `Session` | 404, 422 | `use-sessions.ts` |
| `DELETE /api/sessions/:id` | `api.deleteSession(id)` | – | `204` (idempotent; storage, vectors, recordings cleaned up in the background) | – | `use-sessions.ts` |
| `POST /api/sessions/:id/start` | `api.startSession(id)` | – | `200` `Session` (`LIVE`). Then open the socket (§3) | 404, 409 ENDED | `use-sessions.ts` |
| `POST /api/sessions/:id/end` | `api.endSession(id)` | – | `200` `Session` (`ENDED`); notes start automatically | 404, 409 not LIVE | `use-sessions.ts` |

### 2.2 Context & slides (before / during the lecture)

| Method & path | Client call | Request | Response | Errors | Wired in |
| --- | --- | --- | --- | --- | --- |
| `GET /api/sessions/:id/context` | `api.getContext(id)` | – | `200` [`ContextState`](../../packages/contracts/src/domain/context.ts#L25) (status, topics, [`GlossaryTerm[]`](../../packages/contracts/src/domain/context.ts#L13)) | 404 | `use-lecture-data.ts` |
| `PUT /api/sessions/:id/context/text` | `api.setContextText(id, text)` | [`SetContextTextInput`](../../packages/contracts/src/domain/context.ts#L40) `{ text }` | `202` `ContextState` (`PROCESSING`; READY in ~5–20 s) | 404, 422 | `use-lecture-data.ts` |
| `POST /api/sessions/:id/slides` | `api.uploadSlides(id, file)` | multipart `file`: `.pdf .ppt .pptx`, ≤ 50 MB (`SLIDE_UPLOAD_ACCEPT`, `SLIDE_UPLOAD_MAX_BYTES` in `api.ts`) | `202` [`SlideDeck`](../../packages/contracts/src/domain/context.ts#L64) (`PROCESSING`); re-ingests the context when READY | 404, 422 | `use-lecture-data.ts` |
| `GET /api/sessions/:id/slides` | `api.getSlides(id)` | – | `200` `SlideDeck`: [`Slide[]`](../../packages/contracts/src/domain/context.ts#L51) with `imageUrl` (§4), `title`, `text`, `bullets` | **404 if nothing uploaded** (normal) | `use-lecture-data.ts` |

### 2.3 Live data

| Method & path | Client call | Request | Response | Errors | Wired in |
| --- | --- | --- | --- | --- | --- |
| `GET /api/sessions/:id/transcript` | `api.getTranscript(id)` | – | `200` `{ data: CaptionSegment[] }` ([`CaptionSegment`](../../packages/contracts/src/domain/captions.ts#L40)), by `seq`. Use on (re)connect to backfill | 404 | `use-lecture-data.ts` |
| `POST /api/sessions/:id/sign/utterances` | `api.createSignUtterance(id, body)` | [`CreateSignUtteranceInput`](../../packages/contracts/src/domain/sign.ts#L23) `{ source: SELF\|PEER, speak, tokens: SignToken[] }` | `201` [`SignUtterance`](../../packages/contracts/src/domain/sign.ts#L32) `{ text, alternatives, audioUrl? }` (~1–3 s). Also broadcast as `sign.utterance` | 404, 422 | `use-lecture-data.ts` |
| `GET /api/sessions/:id/sign/utterances` | `api.listSignUtterances(id)` | – | `200` `{ data: SignUtterance[] }` | 404 | `use-lecture-data.ts` |
| `POST /api/sessions/:id/snapshots` | `api.uploadSnapshot(id, blob, fields)` | multipart `file` (jpeg/png/webp/svg ≤ 5 MB) + [`CreateSnapshotFields`](../../packages/contracts/src/domain/snapshots.ts#L36) `{ trigger, reason?, capturedAt? }` | `201` [`Snapshot`](../../packages/contracts/src/domain/snapshots.ts#L18) (`description: null`; filled in by a second `snapshot.captured`) | 404, 422 | `live-lecture-provider.tsx` (via `startSmartSnapshots`) |
| `GET /api/sessions/:id/snapshots` | `api.listSnapshots(id)` | – | `200` `{ data: Snapshot[] }`, oldest first | 404 | `use-lecture-data.ts` |

### 2.4 Recordings (bytes go straight to S3 — see §4.2)

| Method & path | Client call | Request | Response | Errors | Wired in |
| --- | --- | --- | --- | --- | --- |
| `POST /api/sessions/:id/recordings` | `api.createRecording(id, body)` | [`CreateRecordingInput`](../../packages/contracts/src/domain/recordings.ts#L48) `{ source?, contentType? }` | `201` [`Recording`](../../packages/contracts/src/domain/recordings.ts#L35) (`RECORDING`) | 404, 409 not LIVE | `use-lecture-recorder.ts` (via `createRecordingUploader`) |
| `POST /api/sessions/:id/recordings/:recordingId/segments` | `api.createRecordingSegment(id, recId, body)` | [`CreateRecordingSegmentInput`](../../packages/contracts/src/domain/recordings.ts#L54) `{ index, contentType, sizeBytes, startMs, durationMs }` | `201` [`RecordingSegmentUpload`](../../packages/contracts/src/domain/recordings.ts#L72) `{ segment, upload: PresignedUpload }` | 404, 409, 422 | ″ |
| `POST /api/sessions/:id/recordings/:recordingId/segments/:index/complete` | `api.completeRecordingSegment(id, recId, index)` | – | `200` [`RecordingSegment`](../../packages/contracts/src/domain/recordings.ts#L22) (`UPLOADED`; server checks the object exists) | 404, 409 not uploaded | ″ |
| `POST /api/sessions/:id/recordings/:recordingId/finish` | `api.finishRecording(id, recId)` | – | `200` `Recording` (`READY`, or `FAILED` if no segment arrived) | 404 | ″ |
| `GET /api/sessions/:id/recordings` | `api.listRecordings(id)` | – | `200` `{ data: Recording[] }`, each segment with a **fresh** presigned playback `url` | 404 | `use-lecture-data.ts` |

### 2.5 Notes

| Method & path | Client call | Request | Response | Errors | Wired in |
| --- | --- | --- | --- | --- | --- |
| `GET /api/sessions/:id/notes` | `api.getNotes(id)` | – | `200` [`NotesResponse`](../../packages/contracts/src/domain/notes.ts#L56) `{ status, notes: LectureNotes \| null, error }` — always 200 | 404 | `use-lecture-data.ts` |
| `POST /api/sessions/:id/notes` | `api.regenerateNotes(id)` | – | `202` `NotesResponse` (`PROCESSING`) | 404, 409 not ENDED | `use-lecture-data.ts` |
| `GET /api/sessions/:id/notes/export?format=md` | `api.notesExportUrl(id)` → `<a href>` | [`ExportNotesQuery`](../../packages/contracts/src/api.ts) | `200 text/markdown`, `Content-Disposition: attachment`; images embedded, so it works offline | 404 | `notes-library.tsx` |

[`LectureNotes`](../../packages/contracts/src/domain/notes.ts#L40) → [`NoteSection[]`](../../packages/contracts/src/domain/notes.ts#L26)
→ [`NoteBlock`](../../packages/contracts/src/domain/notes.ts#L6) union: `paragraph`, `bullets`, `definition`, `formula` (KaTeX), `image` (a snapshot), `callout` (e.g. BOARD markers).

### 2.6 Media

| Method & path | Who calls it | Response |
| --- | --- | --- |
| `GET /api/assets/:assetId` | The browser, via URLs the server hands out (`slides[].imageUrl`, `utterance.audioUrl`, `snapshot.imageUrl`, note `image` blocks) | `302` → short-lived presigned S3 URL (10 min) after an owner check; `401`/`404` otherwise. See §4.1 |

Development-only engine routes (`/api/dev/*`, not in production) are for backend testing: never call them from the app.

## 3. Live session socket — `wss://…/ws/sessions/:sessionId`

Schema: [`protocols/session-socket.ts`](../../packages/contracts/src/protocols/session-socket.ts) ·
client: [`connectSessionSocket(wsBase, id, { onMessage, onStatus })`](../../packages/contracts/src/client/index.ts#L25)
(typed, zod-validated, reconnects with backoff) · wired in [`use-session-socket.ts`](../../apps/web/src/hooks/use-session-socket.ts) +
[`live-lecture-provider.tsx`](../../apps/web/src/providers/live-lecture-provider.tsx) · details: [realtime-ws.md](realtime-ws.md).

Open it after `POST /start`. Auth = the cookie on the upgrade (anonymous or other users' sessions are refused).
Text frames = JSON; binary frames = mic PCM (client → server only, use `streamMicToSession`, never raw Web Audio).

**Client → server** ([`SessionClientMessage`](../../packages/contracts/src/protocols/session-socket.ts#L32))

| `type` | Payload | Sent by |
| --- | --- | --- |
| `audio.start` | [`AudioFormat`](../../packages/contracts/src/protocols/session-socket.ts#L20) `{ LINEAR16, 16000\|48000, 1 }` | `streamMicToSession` (session must be LIVE) |
| *(binary)* | 16-bit LE PCM, ~100 ms chunks | `streamMicToSession` |
| `audio.stop` | `ts` | `streamMicToSession().stop()` |
| `gaze.transition` | [`GazeTransition`](../../packages/contracts/src/domain/gaze.ts#L24) `{ from, to, targetId, ts }` | every zone change from the gaze bridge (`live-lecture-provider.tsx:102`) |
| `ping` | `ts` | optional keep-alive |

**Server → client** ([`SessionServerMessage`](../../packages/contracts/src/protocols/session-socket.ts#L46))

| `type` | Payload | What the UI does |
| --- | --- | --- |
| `session.ready` | `session`, `isReplay` | First message. `isReplay` = mock lecture, no mic needed |
| `session.status` | `status` | LIVE / ENDED |
| `caption.interim` | `segmentId`, `seq`, `text`, `startMs` | Replace the single "typing" line |
| `caption.final` | `segment` (`FINAL`, raw text) | Append by `seq` |
| `caption.refined` | `segment` (`REFINED`, `parts`: `text`/`term`/`formula`) | Replace by `segment.id` (can arrive after later finals); keep the highest status |
| `slide.pointer` | [`SlidePointer`](../../packages/contracts/src/domain/context.ts#L77) `{ slideIndex, bulletIndex, confidence }` | Flip the slide preview, highlight the bullet |
| `sign.utterance` | `SignUtterance` | Add to the sign conversation; play `audioUrl` if `SELF` |
| `snapshot.request` | `trigger`, `reason`, `segmentId` | The teacher referred to something visual → `startSmartSnapshots` grabs a frame and POSTs it |
| `snapshot.captured` | `Snapshot` | Thumbnail toast; sent again when `description` arrives |
| `notes.status` | `status`, `notesId` | Progress; refetch notes on READY |
| `pong` | `ts` | – |
| `error` | `code` (`BAD_JSON`, `VALIDATION_ERROR`, `NOT_LIVE`, `STT_ERROR`), `message` | Toast; `STT_ERROR` = captions stopped (provider down) |

After a reconnect: `GET /transcript`, merge by `id`, keep REFINED over FINAL (done in `lib/realtime/captions.ts`).

## 4. Files & media

### 4.1 Asset URLs (slide images, sign audio, snapshots)

The server returns **absolute** URLs like `https://api.<domain>/api/assets/ast_…`. Put them straight into `<img>`,
`<audio>`, `<a>`: the browser sends the cookie, the server checks ownership and answers `302` to a presigned S3 URL
valid for 10 minutes. Don't `fetch()` them without `credentials: "include"`, and don't store the redirected S3 URL —
reuse the `/api/assets/…` URL and refetch the parent resource if it's old.

### 4.2 Recordings (direct-to-S3 upload)

Use [`createRecordingUploader(api, sessionId, { contentType })`](../../packages/contracts/src/client/recording-uploader.ts#L12)
(wired in [`use-lecture-recorder.ts`](../../apps/web/src/hooks/live/use-lecture-recorder.ts)). Per ~5-min segment:

```
createRecording ─► (per segment) createRecordingSegment ─► PUT bytes to upload.url with exactly upload.headers (S3, no cookie)
                                  ─► completeRecordingSegment ─► … ─► finishRecording
playback: listRecordings → segments[].url (fresh presigned GET; supports Range → seekable <video>), ordered by startMs
```

The bucket's CORS allows the web origin for `PUT`/`GET` (see [deploy.md](../deploy.md)). Limits and states:
[recordings.md](recordings.md).

### 4.3 Uploads summary

| What | Endpoint | Field | Types | Max |
| --- | --- | --- | --- | --- |
| Slides | `POST …/slides` | `file` | `.pdf .ppt .pptx` | 50 MB |
| Snapshot | `POST …/snapshots` | `file` + `trigger`, `reason?`, `capturedAt?` | jpeg, png, webp, svg | 5 MB |
| Recording segment | presigned `PUT` | raw body | `video/webm`, `video/mp4`, `audio/webm`, `audio/mp4` | 1 GiB (`RECORDING_SEGMENT_MAX_BYTES`) |

## 5. Services on the student's laptop (browser ↔ localhost, no server involved)

### 5.1 Gaze bridge — `ws://localhost:7777` (Arunya's tracker behind Ashwath's bridge)

Schema: [`protocols/gaze-bridge.ts`](../../packages/contracts/src/protocols/gaze-bridge.ts) · client:
[`connectGazeBridge(url, handlers)`](../../packages/contracts/src/client/index.ts#L38) · wired in
[`use-gaze-bridge.ts`](../../apps/web/src/hooks/use-gaze-bridge.ts) → `GazeProvider` · mock: `bun run mock:gaze` ·
details: [gaze-bridge.md](gaze-bridge.md).

| Direction | Messages |
| --- | --- |
| bridge → web ([`GazeBridgeMessage`](../../packages/contracts/src/protocols/gaze-bridge.ts#L21)) | `device.status`, `gaze.zone` ([`GazeZone`](../../packages/contracts/src/domain/gaze.ts#L10): `SCREEN BOARD PERSON AWAY UNKNOWN`), `gaze.point`, `gaze.scene` (look → hear), `gaze.targets`, `audio.focus`, `calibration.progress`, `calibration.result` |
| web → bridge ([`GazeBridgeCommand`](../../packages/contracts/src/protocols/gaze-bridge.ts#L100)) | `hello` (auto), `calibration.start`, `calibration.confirm {step}`, `calibration.cancel`, `mode.set`, `audio.focus.lock {targetId}`, `audio.focus.unlock`, `gaze.point.subscribe` |

**Gaze-pause is 100 % client-side** ([`lib/live/gaze-pause.ts`](../../apps/web/src/lib/live/gaze-pause.ts)): on a zone other
than `SCREEN` (ignore `UNKNOWN` = blink) freeze scrolling and bookmark; captions keep arriving over the session
socket; on `SCREEN` show "missed N lines" and resume. No server call. The web app also forwards each transition as
`gaze.transition` (§3) — fire-and-forget, used only for board markers in the notes and board snapshots.

### 5.2 Sign service — `ws://localhost:7788/ws` (Harnoor)

Schema: [`protocols/sign-service.ts`](../../packages/contracts/src/protocols/sign-service.ts) · client:
[`connectSignService`](../../packages/contracts/src/client/index.ts#L49) · wired in
[`use-sign-service.ts`](../../apps/web/src/hooks/use-sign-service.ts) · mock: `MOCK_SIGN_AUTO=1 bun run mock:sign` ·
details: [sign-service.md](sign-service.md).

web → service: `stream.start`, `frame` (webcam JPEG via `startWebcamFrames`), `stream.stop`, `phrase.reset`.
service → web: `service.ready`, `hands.status`, `sign.partial`, `sign.token`, `phrase.end` → then
`POST /sign/utterances` (§2.3) with the phrase's tokens to get the sentence + audio.

### 5.3 Speaker service (look → hear) — `ws://127.0.0.1:7799/live` (Ashwath)

Don't drive it by hand: [`startLookToHear({ mic, sceneVideo, speakerUrl, gazeBridgeUrl, onState })`](../../packages/live-client/src/browser.ts)
from `@sightline/live-client` (wired in [`use-voice-focus.ts`](../../apps/web/src/hooks/live/use-voice-focus.ts)) handles
`configure`, binary PCM + frames, `target` selection from `gaze.scene`, and playback. `onState` gives faces, the
selected target, status and playback delay; `lth.select(faceId)` is the click fallback. Health:
`GET http://127.0.0.1:7799/health` ([`SpeakerHealth`](../../packages/contracts/src/protocols/speaker-service.ts#L131)).
Mock: `bun run mock:speaker` · details: [speaker-service.md](speaker-service.md).

## 6. Screen → API map

| Screen (`apps/web/src/app/(workspace)/…`) | REST | Sockets / services |
| --- | --- | --- |
| Sign in / sign up | `/api/auth/*`, `me` | – |
| Dashboard | `listSessions`, `createSession`, `deleteSession` | – |
| Setup (hardware check + calibration) | `health` | gaze bridge `device.status`, `calibration.*`; speaker `/health`; sign `service.ready` |
| Lecture prep (`lecture/`) | `createSession`, `setContextText`, `uploadSlides`, `getSlides`, `getContext`, `updateSession` (mode) | gaze bridge `mode.set` |
| Live (`lecture/[sessionId]`) | `startSession`, `endSession`, `getTranscript`, `uploadSnapshot`, recordings (§2.4) | session socket, gaze bridge, speaker service, mic |
| Sign (`sign/`) | `createSignUtterance`, `listSignUtterances` | sign service, session socket `sign.utterance` |
| Notes (`notes/`, `notes/[sessionId]`) | `getNotes`, `regenerateNotes`, export URL, `listSnapshots` | session socket `notes.status` |
| Recordings (`recordings/`, `recordings/[sessionId]`) | `listRecordings`, `getTranscript` | – |

## 7. Integration status (checked against `main` @ Sahil's latest push)

✅ Every REST call in §2 is wired through the typed client (`use-sessions.ts`, `use-lecture-data.ts`,
`live-lecture-provider.tsx`, recordings via `createRecordingUploader`). ✅ Session socket, gaze bridge, sign service,
mic, look → hear and smart snapshots are wired through the shared clients. ✅ Auth flows tested end to end.

Open on the frontend:

1. **Setup page is a placeholder** (`app/(workspace)/setup/page.tsx`): build the hardware check (bridge
   `device.status`, `api.health()`, mic/webcam permissions, speaker `/health`, sign `service.ready`) and the
   calibration flow — this is what Arunya's real tracker needs.
2. **`useGazeBridge` has no calibration commands yet**: expose `startCalibration()`, `confirmCalibration(step)`,
   `cancelCalibration()` (`calibration.start/confirm/cancel`); draw the dot from `calibration.progress.target`, show
   `calibration.result`. Optional: `lockFocus(targetId)` / `unlockFocus()` (`audio.focus.lock/unlock`).
3. Handle the socket `error` with `code: "STT_ERROR"` visibly (captions stopped), not just in the console.

## 8. Running against the real backend

```bash
# server with everything real (keys in apps/server/.env)
cd apps/server && USE_MOCK_DATA=false bun run dev
# web
bun run dev:web            # NEXT_PUBLIC_SERVER_URL=http://localhost:3000
# whole-backend check the server must pass (Postgres, S3, Qdrant, LLMs, STT/TTS)
bun run --filter server check:e2e
```

Without hardware: `bun run dev:demo` (server in mock mode + gaze/sign/speaker mocks) — see [mock-mode.md](mock-mode.md).
