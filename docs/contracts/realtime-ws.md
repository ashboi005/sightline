# Session WebSocket contract (web ↔ server)

**Source of truth:** [`packages/contracts/src/protocols/session-socket.ts`](../../packages/contracts/src/protocols/session-socket.ts).
**Client:** `connectSessionSocket(wsBaseUrl, sessionId, { onMessage, onStatus })` from `@sightline/contracts/client`.
**Implementation owner:** Tushar (`apps/server/src/modules/platform/realtime/`).

```
URL:  ${NEXT_PUBLIC_SERVER_WS_URL}/ws/sessions/:sessionId      (local: ws://localhost:3000/ws/sessions/ses_…)
Auth: better-auth cookie on the upgrade request (skipped with MOCK_AUTH)
Text frames: JSON, one message each, discriminated by "type"
Binary frames: client → server only — raw mic audio after "audio.start"
```

## Lifecycle

```
web                                   server
 │  POST /start (REST)                  │
 │──── connect ────────────────────────►│
 │◄─── session.ready {session,isReplay} │
 │──── audio.start {LINEAR16,16k,mono} ─►│  (ignored in mock-speech: a lecture replay is already running)
 │════ binary PCM chunks (~100 ms) ════►│──► Deepgram
 │◄─── caption.interim (replace line)   │
 │◄─── caption.final   (append)         │──► IntelligenceEngine.refineCaption
 │◄─── caption.refined (replace by id)  │
 │◄─── slide.pointer   (P1)             │
 │──── gaze.transition (on every zone change from the gaze bridge)
 │◄─── sign.utterance  (after POST /sign/utterances)
 │  POST /end (REST)                    │
 │◄─── session.status ENDED             │
 │◄─── notes.status PROCESSING → READY  │
```

## Client → server

| type | fields | when |
| --- | --- | --- |
| `audio.start` | `format: { encoding: "LINEAR16", sampleRate: 16000 \| 48000, channels: 1 }`, `ts` | Mic on. Session must be LIVE |
| *(binary)* | 16-bit little-endian PCM | ~every 100 ms after `audio.start` |
| `audio.stop` | `ts` | Mic off |
| `gaze.transition` | `transition: { from, to, targetId, ts }`, `ts` | Every zone change received from the gaze bridge |
| `ping` | `ts` | Optional keep-alive (server answers `pong`) |

## Server → client

| type | fields | UI behaviour |
| --- | --- | --- |
| `session.ready` | `session`, `isReplay` | First message. `isReplay: true` = mock lecture, mic not needed |
| `session.status` | `status` | LIVE / ENDED |
| `caption.interim` | `segmentId`, `seq`, `text`, `startMs` | Replace the single "typing" line |
| `caption.final` | `segment` (status FINAL, raw text, one text part) | Append (by `seq`), remove interim |
| `caption.refined` | `segment` (status REFINED, `parts` with terms/formulas) | Replace the segment with the same `id`. Can arrive after later finals |
| `slide.pointer` | `pointer: { slideIndex, bulletIndex, confidence }` | P1: flip preview + highlight bullet |
| `sign.utterance` | `utterance` | Add to the conversation panel; play `audioUrl` if `source = SELF` |
| `notes.status` | `status`, `notesId` | Show progress; fetch notes on READY |
| `pong` | `ts` | |
| `error` | `code`, `message` | Show toast / log. Codes: `BAD_JSON`, `VALIDATION_ERROR`, `NOT_LIVE`, `STT_ERROR` |

## Rendering a caption segment

```ts
for (const part of segment.parts) {
  if (part.type === "text")    render(part.text);
  if (part.type === "term")    renderTerm(part.text, { tooltip: glossary[part.glossaryTermId], was: part.original });
  if (part.type === "formula") katex.render(part.latex, el, { displayMode: part.display === "BLOCK" });
}
```

## Gaze-pause (Deaf mode) — all client-side

The server does **not** pause anything. The web app keeps a `bookmarkSeq` when the gaze bridge reports a zone
other than `SCREEN`/`UNKNOWN`, keeps appending captions without scrolling, highlights everything with
`seq > bookmarkSeq`, and resumes auto-scroll when the zone returns to `SCREEN`. It forwards each transition as
`gaze.transition` so the server can compute `AwayWindow`s for the notes (P1 board markers).

## Reconnects

`createTypedSocket` reconnects with backoff. After a reconnect: `GET /transcript` to backfill, then continue
from the socket (de-duplicate by segment `id`, keep the highest status: REFINED > FINAL).
