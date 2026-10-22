# Backend module contracts (Ashwath core ↔ Tushar surrounding)

Both modules live in one deployable (`apps/server`) and talk **in-process** through interfaces. Each side has a
mock, so neither waits for the other.

```
apps/server/src/
├── modules/live/       ASHWATH — core: socket, STT → captions → CaptionEngine, TTS, sign sentences
├── modules/platform/   TUSHAR  — surrounding: sessions, store, slides, KnowledgeEngine (RAG), NotesEngine, auth
├── shared/ports.ts     the server-internal seams (SessionStore, AssetStore, UserResolver, SessionEvents, SessionLifecycle)
└── container.ts        picks real vs mock for every port from the MOCK_* flags
```

## Who calls what

```
                     ┌──────────────── Tushar (platform) ────────────────┐
                     │ SessionStore · AssetStore · UserResolver           │
 Ashwath (live) ────►│ KnowledgeEngine: getGlossary, retrieveContext,     │
                     └────────────────────────────────────────────────────┘
                     ┌──────────────── Ashwath (live) ───────────────────┐
 Tushar (platform) ─►│ SessionLifecycle: onSessionStarted / Ended / Deleted│
                     │ SessionEvents:    publish(sessionId, message)      │
                     └────────────────────────────────────────────────────┘
 Tushar's NotesEngine reads the transcript that Ashwath's pipeline wrote, via SessionStore.
```

## Contract-level engines (`packages/contracts/src/services/`)

### `CaptionEngine` — Ashwath · [`captions.ts`](../../packages/contracts/src/services/captions.ts) · flag `MOCK_CAPTIONS`

| Method | When | Budget |
| --- | --- | --- |
| `refineCaption({ sessionId, segment, previous })` → `{ text, parts, corrections, confidence }` | every FINAL segment | **< 1.5 s p95** |
| `composeSignSentence({ sessionId, tokens, source, recentCaptions })` → `{ text, alternatives, confidence }` | `POST /sign/utterances` | < 2 s |

The implementation gets a `KnowledgeEngine` by constructor injection. `getGlossary` is used on every segment; `retrieveContext` only when `CAPTIONS_USE_RAG=true` (300 ms budget, failures ignored). Real engine: Mastra agents through **Merge Gateway** (`CAPTION_MODEL`, `SIGN_MODEL`, default `zai/glm-5.3-flash`) under `CAPTION_TIMEOUT_MS`, with a glossary-only fallback. Hinglish/Devanagari is kept as spoken.

### `SlideLocator` — Ashwath · [`captions.ts`](../../packages/contracts/src/services/captions.ts)

`locate({ sessionId, text, currentSlideIndex })` → `SlidePointer | null`, called after each refinement (< 50 ms).
It uses lexical TF-IDF over the deck from `SessionStore.getSlideDeck` with hysteresis; no RAG.

### `KnowledgeEngine` — Tushar · [`knowledge.ts`](../../packages/contracts/src/services/knowledge.ts) · flag `MOCK_KNOWLEDGE`

| Method | Called by | Budget |
| --- | --- | --- |
| `ingestContext({ sessionId, title, subject, text, slides })` → `{ glossary, topics, chunkCount, sttKeyterms }` | platform, after context text / slides READY | < 20 s |
| `getGlossary(sessionId)` → `GlossaryTerm[]` | **Ashwath's hot path** (STT keyterms, fast corrections) — cache it | < 50 ms |
| `retrieveContext({ sessionId, query, limit })` → `ContextChunk[]` | Ashwath's refiner / sign composer, Tushar's notes | < 300 ms p95 |
| `dropSession(sessionId)` | platform on delete | – |

### `NotesEngine` — Tushar · [`notes.ts`](../../packages/contracts/src/services/notes.ts) · flag `MOCK_NOTES`

| Method | Called by | Budget |
| --- | --- | --- |
| `generateNotes({ session, context, slides, transcript, awayWindows, snapshots })` → `NotesDraft` | platform job after `end` / regenerate | < 60 s |

## Rules

1. **Low confidence is not an error.** Return the input unchanged (`confidence < 0.5`), `[]` or `null`.
2. **Throw only on real failures.** Callers degrade: raw FINAL caption stays on screen, refinement runs without
   context, notes are marked `FAILED`. Nothing blocks the UI.
3. **Formulas** are `CaptionPart { type: "formula", latex, spoken, display }` with KaTeX-valid LaTeX.
   **Terms** from the glossary are `{ type: "term", glossaryTermId, original }`. `text` = concatenated parts.
4. Per-session state (Qdrant collection, caches) is keyed by `sessionId` and owned by whoever owns the engine.
5. Never import across modules except through `shared/ports.ts` or the contract engines.

## Dev routes (non-production) — test each engine with curl

```
Ashwath:  GET  /api/dev/captions                 POST /api/dev/captions/refine          POST /api/dev/captions/compose-sign
          POST /api/dev/captions/locate-slide
Tushar:   GET  /api/dev/knowledge                POST /api/dev/knowledge/ingest         GET  /api/dev/knowledge/glossary/:id
          POST /api/dev/knowledge/retrieve
          GET  /api/dev/notes                    POST /api/dev/notes
```

Golden examples: `packages/mocks/fixtures/kirchhoff.script.json` (raw → refined, slide pointers),
`sign.phrases.json` (gloss → sentence), `kirchhoff.notes.json` (notes), `kirchhoff.context.json` (glossary).
