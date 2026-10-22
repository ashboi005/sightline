# Ashwath — Core: Live Pipeline, Smart Captions, Gaze/Audio Focus, Deploy

> Back to [overview](../00-overview.md). Your contracts: [backend modules](../contracts/backend-modules.md) ·
> [session socket](../contracts/realtime-ws.md) · [gaze bridge](../contracts/gaze-bridge.md).

## Mission

You own the **core of the problem**: what the student hears and reads, live.

1. Live captions: mic → Deepgram STT → captions over the WebSocket, with the lowest possible latency.
2. Context-locked correction and spoken formulas → LaTeX (module 3, `CaptionEngine`).
3. Gaze software: turning tracker output into zones/targets, plus the look → hear voice isolation (modules 1 & 2).
4. Sign sentences + speech: gloss → sentence (`CaptionEngine`) → ElevenLabs/Sarvam TTS (module 4).
5. Deployment: Coolify on the VPS, including Postgres + Qdrant, which you then hand over to Tushar.

## You own

| Thing | Where | Status |
| --- | --- | --- |
| Session WebSocket + hub | `apps/server/src/modules/live/realtime/` | ✅ working |
| Live caption pipeline (STT → final → refine → refined → slide pointer) | `…/live/realtime/live-captions.ts` | ✅ working |
| Transcript + sign utterance routes | `…/live/routes.ts`, `sign-utterances.ts` | ✅ working |
| **CaptionEngine (Mastra)** | `…/live/captions/mastra-caption-engine.ts` | ⛔ stub (mock + glossary fast path exist) |
| **Deepgram streaming STT** | `…/live/speech/deepgram-stt.ts` | ⛔ stub (replay mock exists) |
| **ElevenLabs / Sarvam TTS** | `…/live/speech/tts.ts` (`ProviderTts`) | ⛔ stub (chime mock exists) |
| **Look-to-hear speaker service** | `apps/speaker-service/` + `protocols/speaker-service.ts` | ✅ working with the real model (see its README for measurements) |
| **Gaze bridge** (zones + `gaze.scene`) | `apps/gaze-bridge/` | skeleton speaks the protocol; plug in Arunya's tracker output |
| Deploy (Coolify, compose, Dockerfiles, VPS Qdrant/Postgres) | repo root | todo |

## You do NOT own

Sessions/DB/auth, slides, the RAG index, or notes; those are Tushar's. You use them through `SessionStore`,
`AssetStore`, `UserResolver` and `KnowledgeEngine` (all mockable), and Tushar calls you only through
`SessionLifecycle` + `SessionEvents`.

## How you work without anyone else

```bash
# apps/server/.env
USE_MOCK_DATA=true          # Tushar's side mocked (knowledge/notes/store/slides/auth)
MOCK_CAPTIONS=false         # your real CaptionEngine
MOCK_SPEECH=true            # replay lecture (no mic) — set false when Deepgram is wired
bun run dev:server
curl -XPOST localhost:3000/api/dev/captions/refine -H 'content-type: application/json' -d '{
  "sessionId":"ses_test","previous":[],
  "segment":{"id":"seg_1","sessionId":"ses_test","seq":0,"startMs":0,"endMs":4000,
             "text":"the summation of i k from k equals one to n equals zero","isFinal":true,"speaker":null,"confidence":0.9}}'
```

The replay lecture runs through **your real engine** in the full app, so you see corrections live in the UI.
The mock KnowledgeEngine gives you the Kirchhoff glossary and a naive `retrieveContext`.

Deps to add as you go: `bun add --cwd apps/server @mastra/core @deepgram/sdk` (+ the AI SDK provider for your model).

## Implementation notes

- **CaptionEngine.refineCaption:** pass 1 is `refineWithGlossary` (`live/captions/glossary-refiner.ts`, instant).
  Pass 2 is a fast LLM with structured output `CaptionPart[]`, grounded with `knowledge.retrieveContext` and the
  previous segments. Spoken maths becomes KaTeX LaTeX. The golden set is `kirchhoff.script.json` (raw → refined).
- **DeepgramStt:** live websocket with `linear16`, `interim_results`, `smart_format`, and `keyterm` set from the
  glossary (already passed in `SttStreamOptions.keyterms`). Use one segment id per utterance for its interims and
  final, and send keep-alives during silence.
- **TTS:** ElevenLabs by default, Sarvam via `TTS_PROVIDER=sarvam`. Return `audio/mpeg` bytes and cache by text.
- **Gaze bridge:** zones from tracker output (screen rectangle from calibration; above the screen = BOARD),
  150 ms debounce, 1 Hz heartbeat, plus `gaze.scene` (gaze in scene-camera coordinates) for look-to-hear.
- **Speaker service** (`bun run speaker:setup`, `bun run speaker:dev`): scene frames + room mic → faces → the
  web app selects a face from `gaze.scene` with `createGazeTargetSelector` → the RTFS-Net-extracted voice is
  streamed back. Next steps: on-device latency tuning, an RNNoise wheel on macOS 26+ (or `--noise off`), and
  testing with the real tracker's scene camera.
- **Deploy:** Coolify runs server + web from the Dockerfiles, with Postgres + Qdrant as services, a volume on
  `STORAGE_DIR`, and `wss://` for `NEXT_PUBLIC_SERVER_WS_URL`. Give Tushar the Qdrant URL/key when it's up.

## Done when

- [ ] Real mic → Deepgram → captions in the UI, interims < 1 s
- [ ] Kirchhoff replay through the real CaptionEngine matches the golden refinements (terms + formulas)
- [ ] Looking at teacher vs classmate switches the earphone audio
- [ ] Sign phrase → spoken sentence end-to-end
- [ ] Deployed on the VPS; Qdrant handed to Tushar
