# REST API examples (web ↔ server)

**Source of truth:** [`packages/contracts/src/api.ts`](../../packages/contracts/src/api.ts) (route table) and
`src/domain/*.ts` (shapes). **Typed client:** `createSightlineApi()` from `@sightline/contracts/client`.
**Implementation owners:** Tushar — sessions / context / slides / notes (`apps/server/src/modules/platform/routes.ts`);
Ashwath — transcript + sign utterances (`apps/server/src/modules/live/routes.ts`).

> **The complete, current endpoint list now lives in [frontend-api.md](frontend-api.md)** (REST, auth, session socket,
> direct-to-S3 media and the laptop services, each pointing at its schema and where the web app calls it).
> This page keeps the request/response examples.

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
