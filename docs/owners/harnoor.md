# Harnoor — Sign Language Recognition

> Current runtime: one CPU A–Z landmark classifier, movement suppression and a one-second letter hold. Legacy CNN/word-model code and CUDA dependencies are removed. Previous four-frame video results below are historical: the current priority-video reevaluation returns K and fails. See the [fresh setup and testing guide](../../apps/sign-service/README.md).


> Back to [overview](../00-overview.md). Your protocol: [contracts/sign-service.md](../contracts/sign-service.md).

## Mission

Read hand signs from the laptop webcam and turn them into accurate **gloss tokens** (ASL-style UPPERCASE
labels like `PLEASE`, `REPEAT`, `FORMULA`, fingerspelled `OHM`). That's it — accuracy and speed of recognition
are entirely yours.

## You own

| Thing | Where |
| --- | --- |
| Sign recognition model (landmarks + classifier, or end-to-end) | [`apps/sign-service/`](../../apps/sign-service) |
| Phrase segmentation (detecting "the signer finished") | sign service |
| Vocabulary choice + training/eval data | sign service |

## You do NOT own

- Turning gloss into a fluent English sentence → Ashwath's LLM (`composeSignSentence`).
- Speaking it aloud → Ashwath's TTS.
- The webcam UI / sign panel → Sahil.

## What you produce (your contract)

A WebSocket server at `ws://localhost:7788/ws` that accepts `stream.start`, `frame` (base64 JPEG),
`stream.stop`, `phrase.reset` and emits `service.ready`, `hands.status`, `sign.partial`, `sign.token`,
`phrase.end`. Exact fields: [contracts/sign-service.md](../contracts/sign-service.md); JSON Schemas:
`packages/contracts/json-schema/sign-service.*.json`.

Requirements:

- Handle 10–15 fps; keep intake/tracking near 60 ms and run GPU inference asynchronously, dropping older pending frames. Aim for token updates about one second after a completed sign.
- `sign.token.confidence` must be honest — the LLM uses it to weigh alternatives.
- `phrase.end` after ~1 s of hands down (tunable) so the student's question gets sent promptly.
- `source: PEER` streams (someone else signing at the camera) use the same pipeline.

## What you consume

Webcam frames from the web app. Nothing else.

## How you work without anyone else

```bash
bun run sign:setup
bun run sign:verify --offline
bun run sign:dev
# Second terminal: bun run sign:camera
```

- Develop the model offline with OpenCV webcam capture; use the per-connection `Recognizer.track()` / `predict()` pipeline.
- Target vocabulary to start with: `packages/mocks/fixtures/sign.phrases.json` — these are the demo phrases
  ("PLEASE REPEAT FORMULA", "QUESTION KCL MEANING WHAT", "SLOW PLEASE", "BOARD WRITE AGAIN", "HELLO ME NAME R-I-A",
  "THANK-YOU"). Nail these first, then grow.
- Reference behaviour: `bun run mock:sign` (TypeScript mock) emits exactly what the UI expects.

## Suggested plan

1. MediaPipe Hands → per-frame landmarks (both hands; hand crops for the alphabet model).
2. Pinned pretrained alphabet classifier plus a rolling pretrained WLASL video classifier; no local training or prototype calibration.
3. Commit a token when the prediction is stable for N frames above a threshold; emit `sign.partial` before.
4. Fingerspelling (static handshapes) for names/acronyms → `kind: "FINGERSPELL"`.
5. Phrase end = no hands for ~1 s.

Unsupported words may be fingerspelled generically (approved handoff completion decision). The current video checkpoint lacks FORMULA and BOARD. Runtime execution checks do not establish recognition accuracy. CUDA FP16 model execution and automated lifecycle/protocol checks pass on the RTX 3050; live recognition/M2 acceptance is still open. See [implementation record](../implementation/sign-service-plan.md).

## Done when

- [ ] The six demo phrases are recognised reliably by at least two team members' signing
- [ ] Web app → your service → server compose → spoken sentence works (checkpoint **M2**)
- [ ] `phrase.reset` and `stream.stop` behave correctly
