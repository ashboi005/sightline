# Tushar — Surrounding: Sessions, Knowledge (RAG), Notes, Slides, Persistence

> Back to [overview](../00-overview.md). Your contracts: [backend modules](../contracts/backend-modules.md) ·
> [REST API](../contracts/rest-api.md).

## Mission

Everything around the live core: session lifecycle and storage, slide uploads, the lecture-context RAG index
(used live by Ashwath's caption pipeline and mostly by your notes), and the post-lecture notes.

## You own

| Thing | Where | Status |
| --- | --- | --- |
| Session / context / slides / notes routes | `apps/server/src/modules/platform/routes.ts` | ✅ working |
| Business logic + notes job | `…/platform/platform-service.ts` | ✅ working |
| Auth resolver (better-auth) | `…/platform/auth.ts` | ✅ working |
| Away windows (gaze → missed segments) | `…/platform/notes/away-windows.ts` | ✅ working |
| **KnowledgeEngine (Qdrant RAG + glossary)** | `…/platform/knowledge/qdrant-knowledge-engine.ts` | implemented; real-service acceptance pending |
| **NotesEngine (Mastra workflow)** | `…/platform/notes/llm-notes-engine.ts` | implemented; provider quality/timing acceptance pending |
| **Postgres store** | `…/platform/store/postgres-store.ts` + `packages/db/src/schema/sightline.ts` | implemented; real-service acceptance pending |
| **PDF/PPTX → slide images + text** | `…/platform/slides/slide-processor.ts` (`FileSlideProcessor`) | implemented; converter acceptance pending |
| P1: board-heavy note markers + snapshot placement | NotesEngine | board markers implemented; real snapshot placement pending |

Implementation decisions, verification status and Docker/migration/recovery instructions are in [platform operations](../implementation/tushar-operations.md) and the [progress ledger](../implementation/tushar-progress.md).

## ✅ Ready for you to use (from Ashwath's side)

The live core is wired with real providers behind the same interfaces, so nothing on your side has to change:

| What | Where | How you consume it |
| --- | --- | --- |
| **STT (Deepgram)** → captions | `modules/live/speech/deepgram-stt.ts` → `live-captions.ts` | Every FINAL/REFINED `CaptionSegment` is written through **your** `SessionStore.upsertSegment`. Read the transcript for notes with `store.listSegments(sessionId)` |
| **Caption refinement** (glossary terms + KaTeX formulas) | `modules/live/captions/` | Uses **your** `KnowledgeEngine.getGlossary` on every segment (STT keyterms + fixes). `retrieveContext` is only called when `CAPTIONS_USE_RAG=true` (off until your RAG is real). Keep `getGlossary` cached and fast |
| **TTS (ElevenLabs / Sarvam)** | `modules/live/speech/tts.ts` (`TextToSpeech`) | Need speech for something (e.g. reading notes aloud)? Take a `TextToSpeech` in your constructor; it's created in `container.ts` |
| Gaze away-windows | socket → `store.addGazeTransition` | Already feeds `deriveAwayWindows` for your notes (P1 board markers) |

Flip `MOCK_SPEECH=false` / `MOCK_CAPTIONS=false` (with keys) and the replay lecture is replaced by real mic audio.

**Recent interface changes that touch you (all additive or removals of work you no longer own):**

- **Slide pointer moved to Ashwath.** `KnowledgeEngine.locateSlide` is gone, so don't implement it. Ashwath's
  `LexicalSlideLocator` reads your deck via `SessionStore.getSlideDeck`, so a real slide pipeline lights it up
  automatically.
- **Snapshots.** `SessionStore.upsertSnapshot` / `listSnapshots` were added (memory store done; implement them in
  `PostgresStore`, table `snapshot` drafted in `packages/db`). `GenerateNotesInput.snapshots` now carries the board
  snapshots, and `NoteBlock` has a new `image` type: place each snapshot in the section whose captions overlap
  `snapshot.segmentIds` (see `placeSnapshots` in `mock-notes-engine.ts`).
- **Recordings + storage.** `SessionStore.upsertRecording` / `getRecording` / `listRecordings` were added (memory
  done; implement in `PostgresStore`, table `recording` drafted). Assets now sit on `ObjectStorage`
  (`lib/storage.ts`: local disk in dev, S3 in prod). `AssetStore` gained an optional `directUrl` (presigned GET).
- **LLMs go through Merge Gateway.** For your notes/glossary agents use `gatewayModel(gateway, ENV.LLM_MODEL)` from
  `src/lib/llm-gateway.ts` (default `zai/glm-5.3-flash`). Embeddings still use `EMBEDDING_MODEL` + `OPENAI_API_KEY`.

## You do NOT own

The live pipeline, STT/TTS, the WebSocket, caption refinement, sign sentences, the gaze software, or deployment.
Those are Ashwath's. You reach the live module only through `SessionLifecycle` (start/end/delete) and
`SessionEvents` (publish `notes.status`, `session.status`), both in `apps/server/src/shared/ports.ts`.

## Step 1 — local Qdrant (do this first)

Ashwath will deploy a shared Qdrant on the VPS and hand it to you later. Until then, run it locally:

```bash
bun run infra:up                      # docker-compose.dev.yml → Qdrant :6333 (+ Postgres :5432)
# or just Qdrant:
docker run -d --name sightline-qdrant -p 6333:6333 -p 6334:6334 -v sightline-qdrant:/qdrant/storage qdrant/qdrant:v1.15.4
open http://localhost:6333/dashboard  # Qdrant UI
```

`apps/server/.env`: `QDRANT_URL=http://localhost:6333` (no `QDRANT_API_KEY` needed locally). When Ashwath hands
over the VPS instance, only `QDRANT_URL` / `QDRANT_API_KEY` change.

## How you work without anyone else

```bash
# apps/server/.env
USE_MOCK_DATA=true        # Ashwath's side mocked (captions, speech) — the replay lecture still produces a transcript
MOCK_KNOWLEDGE=false      # your real RAG
MOCK_NOTES=false          # your real notes
MOCK_PERSISTENCE=true     # flip to false when PostgresStore is done (then: bun run db:push)
bun run dev:server
curl -XPOST localhost:3000/api/dev/knowledge/ingest -H 'content-type: application/json' -d '{
  "sessionId":"ses_test","title":"EE101 L7","subject":null,
  "text":"Kirchhoff current law KCL, voltage law KVL, Ohm law V = IR","slides":[]}'
curl -XPOST localhost:3000/api/dev/knowledge/retrieve -H 'content-type: application/json' -d '{"sessionId":"ses_test","query":"what is KCL"}'
bun run --filter server smoke       # full contract check (keep MOCK_SPEECH=true)
```

Add deps as you go: `bun add --cwd apps/server @qdrant/js-client-rest @mastra/core` (+ an embeddings provider).

## Implementation notes

- **KnowledgeEngine:** collection `ctx_<sessionId>`. Chunk per slide and per bullet, and split free text by
  paragraph. Payload `{ text, source, slideIndex, bulletIndex }`. A glossary agent produces `GlossaryTerm[]` with
  likely STT mis-hearings as `aliases` (e.g. "kerchief" → Kirchhoff); this is what makes Ashwath's captions
  correct. **`getGlossary` must be served from a cache**, because it's on the live hot path.
- **NotesEngine:** outline from topics/slides → per-section writer over transcript ranges (`retrieveContext`
  for grounding) → collect formulas from caption `formula` parts → render `markdown`. Mark sections overlapping
  long BOARD `awayWindows` as `boardFocus`. Target the shape and quality of `kirchhoff.notes.json`.
- **PostgresStore:** tables drafted in `packages/db/src/schema/sightline.ts` (`lecture_session`, because
  `session` is better-auth's). jsonb columns hold contract types.
- **FileSlideProcessor:** `pdftoppm -png` + `pdftotext -layout` per page. PPT/PPTX → PDF via LibreOffice headless
  (Ashwath adds `poppler-utils libreoffice-impress` to the server image when deploying; tell him).

## Done when

- [ ] Real ingest + retrieval on local Qdrant; Ashwath's live pipeline gets a real glossary
- [ ] Notes for a 10-minute lecture with no slides are genuinely useful
- [ ] PostgresStore passes the smoke test with `MOCK_PERSISTENCE=false`
- [ ] Real PDF upload → slide images in the UI

---

## Review — 2026-10-22 (Ashwath, against `origin/main` @ `03a6fc3`)

**Overall:** solid. Persistence, recoverable jobs, private assets, PDF/PPTX conversion, Qdrant RAG with versioned
aliases, glossary-with-mishearings and transcript-led notes with board markers are all in. Type checks pass,
60 tests pass (11 skipped: they need real Postgres/Qdrant/converters/provider keys), and the full mock-mode REST + WebSocket
smoke passes on your branch. What's left / inconsistent, most urgent first:

1. **Snapshots in Postgres — blocks real notes.** `PostgresStore.upsertSnapshot` / `listSnapshots` still throw
   `NOT_IMPLEMENTED`, and the migration has no `snapshot` table (it's in the Drizzle schema). The notes job calls
   `listSnapshots`, so with `MOCK_PERSISTENCE=false` **notes generation fails**. Add the table + both methods.
2. ✅ *Resolved in the merge (routing):* `MastraStructuredModel` now takes the gateway config and uses `gatewayModel(...)`,
   `LLM_MODEL=zai/glm-5.3-flash`, `ANTHROPIC_API_KEY` removed, startup now checks `MERGE_GATEWAY_API_KEY`. Verified live:
   your structured model answered through Merge (~3–8 s). **Still yours:** tolerant schemas (below) and timeouts.
   Original note — **LLM must go through Merge Gateway.** `MastraStructuredModel(ENV.LLM_MODEL)` uses Mastra's own provider router, and
   the merge reverted `LLM_MODEL` to `openai/gpt-4.1-mini` and re-added `ANTHROPIC_API_KEY`. The team only has a Merge key.
   Use `gatewayModel({ url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY }, ENV.LLM_MODEL)` from
   `src/lib/llm-gateway.ts`, default `LLM_MODEL=zai/glm-5.3-flash`, and drop the OpenAI/Anthropic startup checks.
   Measured on real keys: GLM via Merge takes **~2–4 s per call** and **omits optional fields** instead of sending null.
   Make schemas tolerant (`.nullish()`), and budget timeouts for that latency.
3. ✅ *Resolved in the merge:* embeddings use **Gemini** (`GEMINI_API_KEY`, `GEMINI_BASE_URL` OpenAI-compatible endpoint,
   `EMBEDDING_MODEL=gemini-embedding-001`, `EMBEDDING_DIMENSIONS=768`) via your `OpenAIEmbeddings` (now takes
   `baseURL`/`dimensions` and forces `encoding_format: "float"` — Gemini hangs on the SDK's base64 default). Verified live:
   2 × 768-dim vectors in ~0.7 s. Create collections with 768 dimensions. Original note — **Embeddings need a key we don't have.** `OpenAIEmbeddings` needs `OPENAI_API_KEY`, and `initialize()` throws without it
   when `MOCK_KNOWLEDGE=false`. Pick a provider we actually have: check whether Merge Gateway serves `/embeddings`, or
   use Gemini embeddings (the team has Gemini keys), or a local model. Then update `EMBEDDING_MODEL` + the startup check
   (note: changing embedding models changes vector dimensions — recreate collections).
4. **Real notes ignore snapshots.** `LlmNotesEngine` never reads `input.snapshots`, so board images only appear in mock
   notes (the renderer already supports `image` blocks). Place each snapshot in the section whose `sourceSegmentIds`
   overlap `snapshot.segmentIds` (same rule as `placeSnapshots` in `mock-notes-engine.ts`), else by time.
5. ✅ *Resolved in the merge (assets):* `ObjectAssetStore` keeps your ownership model (`AssetIndex`: `PostgresAssetIndex`
   on `platform_asset`, `MemoryAssetIndex` in mocks) but stores bytes in `ObjectStorage` (S3 in prod; **no local disk on
   Coolify**). The asset route checks ownership, then 302s to a presigned S3 GET; `deleteSession` deletes the objects.
   `DiskAssetStore` was replaced (integration test updated). **Still yours:** `PostgresStore` recording methods + table.
   Original note — **Storage → S3 (team decision).** Assets are on local disk (`DiskAssetStore` + `platform_asset`). Ashwath added
   `lib/storage.ts` (`ObjectStorage`: S3/R2/MinIO + a local dev driver, presigned URLs) and session recordings
   (`SessionStore.upsertRecording` / `getRecording` / `listRecordings`, table `recording`). These are on Ashwath's
   branch and merging next. Keep your ownership model (`platform_asset`, `getSessionId`, auth check), but store bytes in
   `ObjectStorage`. The asset route should **check ownership first, then 302 to a presigned GET** on S3.
   `deleteSession` must delete the S3 objects. Implement the recording methods in `PostgresStore` + migration.
6. ◐ *Partly resolved:* `SLIDE_POINTER_*` env + container wiring removed. The unused `QdrantKnowledgeEngine.locateSlide`
   method is still there for you to delete. Original note — **Duplicate slide pointer.** `QdrantKnowledgeEngine.locateSlide` and `SLIDE_POINTER_THRESHOLD` / `SLIDE_POINTER_MARGIN`
   are dead code: the pointer is Ashwath's `LexicalSlideLocator` and isn't part of `KnowledgeEngine` any more. Remove
   them (or keep them deliberately, unwired) so nobody configures knobs that do nothing.
7. **One missing converter stops the whole server.** With `MOCK_SLIDES=false`, `FileSlideProcessor.checkDependencies()`
   throws at startup if `pdftotext`/`libreoffice` are missing, so a Mac dev box can't boot. Prefer failing that one upload
   (deck `FAILED` with the reason) or logging a warning, and keep the Dockerfile as the supported converter runtime.
8. **Bun version drift.** Root `packageManager` is `bun@1.4.4` and the server image is `oven/bun:1.4.4`, but the web image
   is `oven/bun:1` and the rest of the team runs 1.3.10. Pick one version for everyone and Coolify, and confirm the image
   tag builds there.
9. **Private assets outside the app.** Every `/api/assets/:id` now needs the auth cookie. That's fine for `<img>` and
   `<audio>` inside the app (same site), but image links in the **exported Markdown notes** won't load outside it. Decide:
   embed images, or export short-lived presigned links (available once S3 lands).
10. **Real-service acceptance still open** (your ledger says so). Once Ashwath's DB/Qdrant/keys are up, run the opt-in
    suites with `TEST_DATABASE_URL`, `TEST_QDRANT_URL`, `TEST_REAL_CONVERTERS` (in `Dockerfile.dev`), plus a real-key
    ingest → notes run, and record the timings.
11. Minor: the ledger says "do not create branches or commits", but the work landed as commits on `main` (that's fine).
    Update the ledger so it doesn't confuse the next reader.

**Auth: verified end to end (Ashwath, 2026-10-22).** The server side you wired works against real Postgres
(your migration + your 5 Postgres integration tests pass). `bun run --filter server check:auth` passes 21/21:
CORS + credentials, sign-up/sign-in/sign-out, HttpOnly cookie, `/api` 401 without a cookie, cross-user 404s,
WebSocket refused for anonymous/other users, and the old cookie revoked after sign-out. Headless Chrome ran Sahil's real
sign-up form through to the dashboard and back. Added: `AUTH_COOKIE_DOMAIN` → better-auth `crossSubDomainCookies`, so the
production cookie (`__Secure-…; Domain=<parent>; SameSite=None; Secure`) reaches the web app on another subdomain.

**Merge status:** merged into `main` (see the merge commit). The notes above marked ✅ are done; everything else is open.
Previous note: Ashwath's local `main` (ElevenLabs STT, S3 storage, recordings) diverged from `origin/main`.
Expect conflicts in `container.ts`, `index.ts`, `assets/asset-store.ts`, `store/types.ts`, `memory-store.ts`,
`postgres-store.ts`, `packages/db` schema/migrations, `.env.schema`/`.env.example`, `scripts/smoke.ts` and this file.
Ashwath is resolving the merge, so items 1–6 should be done on top of the merged `main`.
