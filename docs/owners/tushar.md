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
