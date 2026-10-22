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
| **CaptionEngine (Mastra)** | `…/live/captions/mastra-caption-engine.ts` (+ `llm.ts`, `prompts.ts`) | ✅ built; glossary fast path + LLM under a 1.5 s deadline, KaTeX-validated; needs an LLM key to go live |
| **Deepgram streaming STT** | `…/live/speech/deepgram-stt.ts` | ✅ built + tested against a fake Deepgram; needs `DEEPGRAM_API_KEY` |
| **ElevenLabs / Sarvam TTS** | `…/live/speech/tts.ts` | ✅ built (cached) + tested with fake HTTP; needs a key |
| **Browser live client** (mic, caption streaming, look-to-hear, player) | `packages/live-client` | ✅ built; controller verified against the real speaker service |
| **LLM via Merge Gateway** (GLM 5.3 Flash captions/sign, GLM 4.5V vision) | `src/lib/llm-gateway.ts`, `live/captions/llm.ts` | ✅ verified against a fake OpenAI-compatible gateway; needs `MERGE_GATEWAY_API_KEY` |
| **Hinglish STT** (Sarvam saaras codemix) | `live/speech/sarvam-stt.ts` (`STT_PROVIDER=sarvam`) | ✅ tested against a fake Sarvam + `check:pipeline sarvam`; needs `SARVAM_API_KEY` |
| **Slide auto-pointer** (P1) | `live/slides/slide-locator.ts` | ✅ 82% slide accuracy on the golden lecture; reads Tushar's deck via `SessionStore` |
| **Smart board snapshots** (P1) | `live/snapshots/*` + `live-client` `startSmartSnapshots` | ✅ speech-cue / board-dwell / visual-change / manual → vision description → notes. Next: pointing-gesture trigger |
| **Look-to-hear speaker service** | `apps/speaker-service/` + `protocols/speaker-service.ts` | ✅ working with the real model (see its README for measurements) |
| **Gaze bridge** (zones + `gaze.scene`) | `apps/gaze-bridge/` | ✅ classifier + protocol tested (fake tracker); plug Arunya's device into `tracker.py` |
| Deploy (Coolify, Dockerfiles, VPS Postgres + Qdrant) | [`docs/deploy.md`](../deploy.md) | guide ready; server bundle verified; run it once keys/VPS are ready |

## You do NOT own

Sessions/DB/auth, slides, the RAG index, or notes; those are Tushar's. You use them through `SessionStore`,
`AssetStore`, `UserResolver` and `KnowledgeEngine` (all mockable), and Tushar calls you only through
`SessionLifecycle` + `SessionEvents`.

## How you work without anyone else

```bash
# apps/server/.env — your side real, Tushar's side mocked
USE_MOCK_DATA=true
MOCK_CAPTIONS=false          # real Mastra caption engine via Merge Gateway (MERGE_GATEWAY_API_KEY)
MOCK_SPEECH=false            # real STT + TTS (STT_PROVIDER=deepgram|sarvam; keys for the chosen providers)
CAPTIONS_USE_RAG=false       # glossary only until Tushar's RAG is real
bun run dev:server
```

| Check | Command | Needs keys? |
| --- | --- | --- |
| Unit tests (TTS, Deepgram, caption engine) | `bun run --filter server test` | no |
| Whole caption pipeline with a fake Deepgram / Sarvam | `bun run --filter server check:pipeline` / `… check:pipeline sarvam` | no |
| Golden-set quality + latency of the real LLM | `bun run --filter server eval:captions` | LLM key |
| Real providers (Merge, Gemini, ElevenLabs TTS→Scribe, Sarvam) | `bun run --filter server check:providers` | yes |
| Auth end to end (cookies, CORS, WS, isolation) | `bun run --filter server check:auth` (server with `MOCK_AUTH=false`) | DB |
| **Whole backend live** (Postgres, S3, Qdrant, GLM, STT/TTS, notes) | `bun run --filter server check:e2e` (server with `USE_MOCK_DATA=false`) | all |
| Live client | `bun run --filter @sightline/live-client test` | no |
| Gaze bridge | `bun run gaze:test` | no |
| Speaker service | `bun run speaker:test` (`SPEAKER_MODEL_TESTS=1` for real-model tests) | no |
| Contract smoke (REST + WS) | `bun run --filter server smoke` (server with `MOCK_SPEECH=true`) | no |

## Implementation notes

- **CaptionEngine.refineCaption:** pass 1 is `refineWithGlossary` (instant, always computed). Pass 2 is a Mastra
  agent (`CAPTION_MODEL`) with flat structured output, under `CAPTION_TIMEOUT_MS`. The output is validated:
  formulas must render in KaTeX, terms are linked to glossary ids, corrections are derived, and an output that
  drops, summarises or pads the transcript is rejected. Any failure returns pass 1. RAG grounding is off until
  `CAPTIONS_USE_RAG=true`. Tune prompts in `prompts.ts` and measure with `eval:captions`.
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
