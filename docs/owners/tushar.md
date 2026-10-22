# Tushar — Backend: Platform & Realtime module

> Back to [overview](../00-overview.md). Contracts you implement: [REST](../contracts/rest-api.md) ·
> [session socket](../contracts/realtime-ws.md). Contract you call: [IntelligenceEngine](../contracts/intelligence-engine.md).

## Mission

Make the backend real: sessions and persistence, uploads and slide rendering, the realtime caption pipeline
(mic audio → Deepgram → captions over WebSocket), TTS, notes orchestration, auth, and deployment on Coolify.

## You own

| Thing | Where | Status |
| --- | --- | --- |
| REST routes | `apps/server/src/modules/platform/routes.ts` | ✅ done (contract-complete) |
| Session socket + hub | `…/platform/realtime/socket.ts`, `hub.ts` | ✅ done |
| Live caption pipeline | `…/platform/realtime/live-captions.ts` | ✅ done (STT → final → refine → refined → slide pointer) |
| Business logic | `…/platform/platform-service.ts` | ✅ done |
| Auth resolver | `…/platform/auth.ts` | ✅ done (better-auth + MOCK_AUTH) |
| **Postgres store** | `…/platform/store/postgres-store.ts` + `packages/db/src/schema/sightline.ts` | ⛔ stub — **yours** |
| **Deepgram STT** | `…/platform/speech/deepgram-stt.ts` | ⛔ stub — **yours** |
| **ElevenLabs / Sarvam TTS** | `…/platform/speech/tts.ts` (`ProviderTts`) | ⛔ stub — **yours** |
| **PDF/PPTX → images + text** | `…/platform/slides/slide-processor.ts` (`FileSlideProcessor`) | ⛔ stub — **yours** |
| Disk asset store | `…/platform/assets/asset-store.ts` | ✅ basic, harden as needed |
| Composition root | `apps/server/src/container.ts` | shared with Ashwath |
| Docker / Coolify deploy, Postgres + Qdrant services | `docker-compose*.yml`, Dockerfiles | yours |

The plumbing already works end-to-end in mock mode — your job is replacing the four ⛔ stubs with real
adapters behind the **existing interfaces** (`SessionStore`, `SpeechToText`, `TextToSpeech`, `SlideProcessor`),
so nothing above them changes.

## You do NOT own

Anything inside `modules/intelligence` (Ashwath). You call it only through `IntelligenceEngine`; if it throws,
keep the raw caption / mark FAILED — never block the UI.

## How you work without anyone else

```bash
bun run infra:up                                   # Postgres + Qdrant
# apps/server/.env: USE_MOCK_DATA=false, MOCK_INTELLIGENCE=true, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY
bun run db:push                                    # creates the tables in packages/db/src/schema
bun run dev:server
bun run --filter server smoke                      # contract check (needs MOCK_SPEECH=true for the replay part)
```

Turn on one real adapter at a time with the per-module flags (`MOCK_PERSISTENCE=false` first, then
`MOCK_SLIDES=false`, then `MOCK_SPEECH=false`).

## Implementation notes

- **PostgresStore:** tables are drafted in `packages/db/src/schema/sightline.ts` (`lecture_session`, not
  `session` — that's better-auth's). jsonb columns hold contract types. `listSegments` ordered by `seq`.
- **DeepgramStt:** live websocket, `linear16`, `interim_results`, `smart_format`, `keyterm` = glossary terms
  (passed in `SttStreamOptions.keyterms`). One `RawTranscriptSegment` id per utterance; same id for its interims
  and final. Keep-alive while the mic is silent.
- **ProviderTts:** ElevenLabs default, Sarvam via `TTS_PROVIDER=sarvam`. Return `audio/mpeg` bytes; cache by text.
- **FileSlideProcessor:** `pdftoppm -png` + `pdftotext -layout` per page; PPT/PPTX → PDF with LibreOffice headless
  (add `poppler-utils libreoffice-impress` to the server Dockerfile). Slide `bullets` = non-empty lines after the title.
- **Deploy:** Coolify — server + web from the Dockerfiles, Postgres + Qdrant as services, volume on `STORAGE_DIR`,
  `wss://` for `NEXT_PUBLIC_SERVER_WS_URL`.

## Done when

- [ ] All four stubs implemented; smoke test passes with `USE_MOCK_DATA=false, MOCK_INTELLIGENCE=true` (checkpoint **M3**)
- [ ] Real mic → Deepgram → captions in Sahil's UI with < 1 s latency for interims
- [ ] Deployed on the VPS with real Postgres/Qdrant (M5)
