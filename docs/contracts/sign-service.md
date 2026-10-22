# Sign service protocol (Harnoor's recogniser ↔ web)

**Source of truth:** [`packages/contracts/src/protocols/sign-service.ts`](../../packages/contracts/src/protocols/sign-service.ts)
· JSON Schema: `packages/contracts/json-schema/sign-service.{message,command}.json`
· Python skeleton: [`apps/sign-service/sign_service/server.py`](../../apps/sign-service/sign_service/server.py)
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
| `stream.stop` | – | Camera off |
| `phrase.reset` | – | Student hit "clear" — drop tokens of the current phrase |

## Service → web

| type | fields | notes |
| --- | --- | --- |
| `service.ready` | `protocolVersion, model, vocabulary[]` | On connect. Vocabulary = every gloss you can output |
| `hands.status` | `handsDetected (0–2)` | ≤ 5 Hz, drives the "hands detected" indicator |
| `sign.partial` | `gloss, confidence` | Live best guess, may change. UI shows it greyed out; never sent to server |
| `sign.token` | `token: { id: "tok_…", gloss, kind: SIGN\|FINGERSPELL\|NUMBER, confidence, ts }` | Committed sign |
| `phrase.end` | `tokenIds[]` | Hands down ~1 s → phrase done. Web then POSTs the tokens |
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
