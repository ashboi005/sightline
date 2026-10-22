# IntelligenceEngine contract (Tushar's platform ↔ Ashwath's intelligence)

**Source of truth:** [`packages/contracts/src/services/intelligence.ts`](../../packages/contracts/src/services/intelligence.ts).
In-process TypeScript interface inside `apps/server` — no network hop.

```
apps/server/src/modules/platform/**   (Tushar)  ──calls──►  IntelligenceEngine  ◄──implements──  apps/server/src/modules/intelligence/** (Ashwath)
                                                             MockIntelligenceEngine (MOCK_INTELLIGENCE=true)
                                                             MastraIntelligenceEngine (real)
```

**Rule:** platform code imports intelligence ONLY via `createIntelligenceEngine()` from
`modules/intelligence/index.ts` and talks to it ONLY through this interface. Intelligence code never imports
platform code; it receives everything it needs as arguments.

## Methods

| Method | Called by / when | Input | Output | Budget |
| --- | --- | --- | --- | --- |
| `ingestContext` | after `PUT /context/text` or slides READY (background) | session title/subject, free text, slide text | glossary, topics, chunkCount, ≤ 100 `sttKeyterms` | < 20 s |
| `getGlossary` | when an STT stream opens (keyterms) | sessionId | `GlossaryTerm[]` | < 50 ms |
| `refineCaption` | every FINAL caption segment | raw segment + ≤ 10 previous refined segments | `text`, `parts` (text/term/formula), `corrections`, `confidence` | **< 1.5 s p95** |
| `locateSlide` (P1) | after each refinement, only if slides READY | refined text + current slide | `SlidePointer \| null` | < 500 ms |
| `composeSignSentence` | `POST /sign/utterances` | gloss tokens, source, ≤ 10 recent captions | sentence + alternatives | < 2 s |
| `generateNotes` | after `end` / regenerate (background) | session, context, slides, full transcript, away windows | `LectureNotes` minus `id`/`generatedAt` | < 60 s |
| `dropSession` | session deleted | sessionId | – | – |

## Behavioural rules

1. **Low confidence is not an error.** If unsure, return the input unchanged with `confidence < 0.5`.
2. **Throw only on real failures** (LLM/Qdrant down). The platform then keeps the raw FINAL caption, marks
   context/notes `FAILED`, or returns the sign tokens joined — the UI never blocks on intelligence.
3. **Formulas** go in `CaptionPart { type: "formula", latex, spoken, display }`. `latex` must be valid KaTeX.
   `display: "BLOCK"` for standalone equations, `"INLINE"` for symbols/values inside a sentence.
4. **Terms** that came from the glossary go in `{ type: "term", glossaryTermId, original }` — `original` is
   what STT heard if it was corrected, else `null`.
5. `text` must equal the concatenation of the parts (formulas as their LaTeX).
6. Per-session state (Qdrant collection, glossary cache) is keyed by `sessionId` and owned by the engine.

## Testing without the rest of the backend

Dev routes (non-production only) expose every method with the exact input schema:

```
GET  /api/dev/intelligence                → { engine: "mock" | "mastra" }
POST /api/dev/intelligence/ingest         IngestContextInput
GET  /api/dev/intelligence/glossary/:id
POST /api/dev/intelligence/refine         RefineCaptionInput
POST /api/dev/intelligence/locate-slide   LocateSlideInput
POST /api/dev/intelligence/compose-sign   ComposeSentenceInput
POST /api/dev/intelligence/notes          GenerateNotesInput
```

Golden examples for every method live in the fixtures: `packages/mocks/fixtures/kirchhoff.script.json`
(`raw` → expected `refined`), `sign.phrases.json` (gloss → expected sentence), `kirchhoff.notes.json`.
