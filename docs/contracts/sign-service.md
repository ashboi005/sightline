# Sign service protocol (Harnoor's recogniser ↔ web)

**Source of truth:** [`packages/contracts/src/protocols/sign-service.ts`](../../packages/contracts/src/protocols/sign-service.ts)
· JSON Schema: `packages/contracts/json-schema/sign-service.{message,command}.json`
· Python service: [`apps/sign-service/sign_service/server.py`](../../apps/sign-service/sign_service/server.py)
· Mock: `bun run mock:sign` (`MOCK_SIGN_AUTO=1` to recognise without a webcam)

```
The service is the WebSocket SERVER:  ws://localhost:7788/ws  (NEXT_PUBLIC_SIGN_SERVICE_URL)
Runs on the laptop or on the VPS — the URL is config.
All frames are JSON text. Protocol version: "1".
```

## The split of responsibilities

```
webcam ─frames─► sign-service ─gloss tokens─► web ─POST /sign/utterances─► server
                 (Harnoor)                    (Sahil)                       (Ashwath: gloss → sentence,
                                                                             + TTS → audioUrl)
```

The service outputs **gloss only** (UPPERCASE sign labels: `PLEASE`, `REPEAT`, fingerspelled `OHM`). It never
builds sentences and never speaks.

## Web → service

| type | fields | notes |
| --- | --- | --- |
| `stream.start` | `protocolVersion, source: SELF\|PEER, fps (1–30), width, height` | Recommended 10–15 fps, 640×480 |
| `frame` | `seq, image (base64 JPEG, no data: prefix, not mirrored), ts` | One webcam frame |
| `stream.stop` | – | Stop recognition; discard the phrase and pending work |
| `phrase.reset` | – | Student hit "clear" — drop tokens of the current phrase |

## Service → web

| type | fields | notes |
| --- | --- | --- |
| `service.ready` | `protocolVersion, model, vocabulary[]` | When models/tracker are usable. Active vocabulary = A-Z spelling alphabet |
| `hands.status` | `handsDetected (0–2)` | ≤ 5 Hz, drives the "hands detected" indicator |
| `sign.partial` | `gloss, confidence, acceptedGloss?` | Stable raw spelling prefix is optional; the remaining gloss suffix is a live guess. Partial updates are never submitted directly |
| `sign.token` | `token: { id: "tok_…", gloss, kind: SIGN\|FINGERSPELL\|NUMBER, confidence, ts }` | Committed sign |
| `phrase.end` | `tokenIds[]` | Hands down ~1 s ends a recognition segment. The browser preserves its draft; only manual Enter/Send POSTs a sentence |
| `error` | `code, message` | |

## Example

```jsonc
// → web
{"type":"stream.start","protocolVersion":"1","source":"SELF","fps":12,"width":640,"height":480}
{"type":"frame","seq":0,"image":"/9j/4AAQSkZJRg…","ts":1761123450000}
// ← service
{"type":"hands.status","handsDetected":2,"ts":1761123450100}
{"type":"sign.partial","gloss":"PLEASE","confidence":0.61,"ts":1761123450600}
{"type":"sign.token","token":{"id":"tok_a1","gloss":"PLEASE","kind":"SIGN","confidence":0.93,"ts":1761123451100},"ts":1761123451100}
{"type":"sign.token","token":{"id":"tok_a2","gloss":"REPEAT","kind":"SIGN","confidence":0.88,"ts":1761123452200},"ts":1761123452200}
{"type":"phrase.end","tokenIds":["tok_a1","tok_a2"],"ts":1761123453300}
```

## Readiness, spelling and lifecycle

An open WebSocket is transport availability, not model readiness. On an unavailable model/tracker the service sends `error {code: "MODEL_UNAVAILABLE"}` without `service.ready`. The browser shows that error and waits for readiness before starting. Protocol version 1 and existing commands/message types remain. The optional `acceptedGloss` field on `sign.partial` separates stable raw spelling from its tentative suffix; older updates without it remain entirely tentative.

`vocabulary` is A-Z in the current alphabet-only service; arbitrary composed fingerspelled words are not enumerated. Letters require about one second of continuous steady fresh evidence (at least four observations); movement or gaps over the cadence allowance (350 ms at the recommended 12 FPS; at least two frame intervals at low FPS) restart the hold. Accepted letters are visible immediately, and different letters need no hands-down interval. A held letter contributes once; a release of at least 0.25 seconds permits a repeated letter. Consecutive accepted letters are reconstructed into FINGERSPELL word tokens at phrase completion. A lexical sign flushes a pending spelling first; approximately one second hands down completes the phrase, preserving token order.

`phrase.reset` discards the current phrase while recognition continues; `stream.stop` discards the phrase and pending inference. Neither submits unfinished tokens. Old inference cannot publish after a reset/stop. On reconnect the browser clears stale phrase state and restarts only if recognition was active, preserving SELF/PEER.

Frame intake/tracking remain responsive while model inference runs asynchronously. Only the newest pending frame/model input is retained per stream. Cached inference is not fresh stability evidence. `hands.status` stays at <=5 Hz even when the detected count changes.

## Manual sentence drafting

The browser appends only newly accepted raw letters from `sign.partial.acceptedGloss`. Dictionary-reconstructed `sign.token` words do not overwrite that draft. Neither `sign.token` nor `phrase.end` submits a sentence or inserts a space. The signer supplies spaces and confirms with Enter/Send; the browser creates one FINGERSPELL token per manually separated word for the existing API. Recognition confidence and SELF/PEER are preserved. Edits/backspace are supported; reconnect/stop retain the draft; clear discards it.
