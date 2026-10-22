# Ashwath — Backend: Intelligence module

> Back to [overview](../00-overview.md). Your contract: [contracts/intelligence-engine.md](../contracts/intelligence-engine.md).

## Mission

Everything that needs understanding: lecture context RAG, context-locked caption correction, spoken-formula →
LaTeX, gloss → natural sentence, structured lecture notes (and P1: slide auto-pointer, board-heavy markers).

## You own

| Thing | Where |
| --- | --- |
| `MastraIntelligenceEngine` (real engine) | [`apps/server/src/modules/intelligence/mastra-engine.ts`](../../apps/server/src/modules/intelligence/mastra-engine.ts) |
| Mastra agents / workflows, prompts, structured outputs | `apps/server/src/modules/intelligence/**` |
| Qdrant collections (`ctx_<sessionId>`), embeddings | same |
| `MockIntelligenceEngine` + dev routes | same (keep the mock in sync with the contract) |
| Golden test set | `packages/mocks/fixtures/kirchhoff.*.json`, `sign.phrases.json` |

## You do NOT own

Sessions, sockets, Deepgram, TTS, uploads/slide rendering, Postgres (Tushar). You never import from
`modules/platform`. You get everything as method arguments and return contract types.

## What you produce

An implementation of `IntelligenceEngine` (`packages/contracts/src/services/intelligence.ts`):
`ingestContext`, `getGlossary`, `refineCaption`, `locateSlide` (P1), `composeSignSentence`, `generateNotes`,
`dropSession`. Budgets and rules: [intelligence-engine.md](../contracts/intelligence-engine.md).

## What you consume

Only the inputs of those methods. Tushar calls you; Tushar's real pipeline falls back gracefully if you throw.

## How you work without anyone else

```bash
bun run infra:up                                  # Qdrant (+ Postgres) via docker-compose.dev.yml
# apps/server/.env: USE_MOCK_DATA=true, MOCK_INTELLIGENCE=false, OPENAI_API_KEY / ANTHROPIC_API_KEY, LLM_MODEL
bun run dev:server
curl -XPOST localhost:3000/api/dev/intelligence/refine -H 'content-type: application/json' -d '{
  "sessionId":"ses_test","previous":[],
  "segment":{"id":"seg_1","sessionId":"ses_test","seq":0,"startMs":0,"endMs":4000,
             "text":"the summation of i k from k equals one to n equals zero","isFinal":true,"speaker":null,"confidence":0.9}}'
```

With `MOCK_SPEECH=true` the replay lecture flows through **your real engine** in the full app, so you see
your corrections live in Sahil's UI without a mic.

Add deps when you start: `bun add --cwd apps/server @mastra/core @qdrant/js-client-rest` (+ the AI SDK provider
for the model you choose).

## Suggested design

| Method | Approach |
| --- | --- |
| `ingestContext` | Chunk slide text (per slide/bullet) + free text → embed → Qdrant. Glossary agent (structured output `GlossaryTerm[]`) that also predicts likely STT mis-hearings as `aliases`. Return ≤ 100 `sttKeyterms` for Deepgram keyterm prompting (Tushar passes them) |
| `refineCaption` | Two-tier: (1) deterministic alias replacement from the glossary (instant), (2) small fast LLM with retrieved chunks + previous segments → `CaptionPart[]` with LaTeX for spoken maths. Cache per segment. Must be < 1.5 s p95 — use a fast model |
| `locateSlide` (P1) | Embed refined text → nearest slide/bullet; hysteresis around `currentSlideIndex` to avoid flicker |
| `composeSignSentence` | Prompt with gloss + confidences + recent captions so "REPEAT FORMULA" resolves to the formula just taught |
| `generateNotes` | Mastra workflow: outline from topics/slides → per-section writer over transcript ranges → collect formulas/terms → render `markdown`. Mark sections overlapping long BOARD `awayWindows` as `boardFocus` (P1) |

Evaluate against the fixtures: every `raw` in `kirchhoff.script.json` should come out close to its `refined`.

## Done when

- [ ] Kirchhoff replay through the real engine matches the golden refinements (terms + formulas)
- [ ] Notes for a real 10-minute lecture with no slides are genuinely useful
- [ ] Real engine wired with Tushar's real pipeline (checkpoint **M4**)
