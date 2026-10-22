# REST API contract (web ↔ server)

**Source of truth:** [`packages/contracts/src/api.ts`](../../packages/contracts/src/api.ts) (route table) and
`src/domain/*.ts` (shapes). **Typed client:** `createSightlineApi()` from `@sightline/contracts/client`.
**Implementation owners:** Tushar — sessions / context / slides / notes (`apps/server/src/modules/platform/routes.ts`);
Ashwath — transcript + sign utterances (`apps/server/src/modules/live/routes.ts`).

## Basics

| | |
| --- | --- |
| Base URL | `NEXT_PUBLIC_SERVER_URL` (local: `http://localhost:3000`) |
| Auth | better-auth cookie → always `fetch(..., { credentials: "include" })`. `MOCK_AUTH=true` → every call is the demo user |
| Bodies | JSON, except slide upload (`multipart/form-data`, field `file`) and notes export (`text/markdown`) |
| Errors | Always `{ "error": { "code", "message", "details"? } }` — codes in [overview §7](../00-overview.md#7-conventions-applies-to-everyone) |
| Long work | Slides, context ingestion and notes run in the background: the call returns `202` + a `PROCESSING` status, then poll the GET or listen on the session socket |

## Endpoints

| Method | Path | Body | → | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | – | `HealthResponse` | Public. Shows which modules are mocked |
| GET | `/api/me` | – | `CurrentUser` | |
| GET | `/api/sessions?page&pageSize` | – | `{ data: Session[], pagination }` | Newest first |
| POST | `/api/sessions` | `CreateSessionInput` | `201 Session` | `contextText` = Option B shortcut |
| GET | `/api/sessions/:id` | – | `Session` | |
| PATCH | `/api/sessions/:id` | `UpdateSessionInput` | `Session` | Mode can change while LIVE |
| DELETE | `/api/sessions/:id` | – | `204` | Idempotent |
| POST | `/api/sessions/:id/start` | – | `Session` | DRAFT → LIVE; then open the session socket |
| POST | `/api/sessions/:id/end` | – | `Session` | LIVE → ENDED; notes start generating |
| GET | `/api/sessions/:id/context` | – | `ContextState` | Glossary + topics + status |
| PUT | `/api/sessions/:id/context/text` | `{ text }` | `202 ContextState` | Re-ingests |
| POST | `/api/sessions/:id/slides` | multipart `file` | `202 SlideDeck` | `.pdf .ppt .pptx`, ≤ 50 MB. Re-ingests when READY |
| GET | `/api/sessions/:id/slides` | – | `SlideDeck` | `404` if nothing uploaded. `slides[].imageUrl` is ready to `<img>` |
| GET | `/api/sessions/:id/transcript` | – | `{ data: CaptionSegment[] }` | Use after (re)connecting the socket |
| POST | `/api/sessions/:id/sign/utterances` | `CreateSignUtteranceInput` | `201 SignUtterance` | Gloss → sentence + `audioUrl` |
| GET | `/api/sessions/:id/sign/utterances` | – | `{ data: SignUtterance[] }` | |
| GET | `/api/sessions/:id/notes` | – | `NotesResponse` | `{ status, notes, error }` — always 200 |
| POST | `/api/sessions/:id/notes` | – | `202 NotesResponse` | Regenerate (ENDED only) |
| GET | `/api/sessions/:id/notes/export?format=md` | – | `text/markdown` | Download |
| GET | `/api/assets/:assetId` | – | binary | Slide images, TTS audio (URLs come from other responses) |

## Status fields on `Session`

```
status:        DRAFT ──start──► LIVE ──end──► ENDED
contextStatus: EMPTY ─► PROCESSING ─► READY | FAILED      (text set or slides READY)
slidesStatus:  EMPTY ─► PROCESSING ─► READY | FAILED      (upload)
notesStatus:   EMPTY ─► PROCESSING ─► READY | FAILED      (end / regenerate)
```

## Examples

```http
POST /api/sessions
{ "title": "EE101 · Lecture 7", "subject": "Basic Electrical Engineering", "mode": "DEAF",
  "contextText": "Kirchhoff's laws: KCL, KVL, Ohm's law recap" }
→ 201 { "id": "ses_…", "status": "DRAFT", "contextStatus": "PROCESSING", … }
```

```http
POST /api/sessions/ses_…/sign/utterances
{ "source": "SELF", "speak": true,
  "tokens": [ { "id": "tok_1", "gloss": "PLEASE", "kind": "SIGN", "confidence": 0.93, "ts": 1761123456789 },
              { "id": "tok_2", "gloss": "REPEAT", "kind": "SIGN", "confidence": 0.88, "ts": 1761123457889 },
              { "id": "tok_3", "gloss": "FORMULA", "kind": "SIGN", "confidence": 0.81, "ts": 1761123458989 } ] }
→ 201 { "id": "utt_…", "text": "Could you please repeat the formula?", "audioUrl": "http://…/api/assets/ast_…", … }
```

```http
POST /api/sessions   { "title": "" }
→ 422 { "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [ … ] } }
```

Run `bun run --filter server smoke` against a mock server to exercise every endpoint and validate every
response against the schemas.
