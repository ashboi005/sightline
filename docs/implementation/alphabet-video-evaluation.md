## Manual sentence drafting follow-up
Manual-draft verification: 51 Python tests and 30 browser/client tests passed, along with workspace types, Ruff, fixture validation and git diff checks. Browser interaction verified Add space, keyboard Space, keyboard Backspace, the Backspace button and Enter. The test draft OPEN THE BOOK stayed unsent until Enter, then persisted once with manually separated words; focus remained in the draft for the next sentence. Later unrelated demo activity was present, so matching test utterance IDs/text were checked rather than assuming the global history count stayed fixed. Backspace does not restore a deleted letter when the same accepted recognition prefix repeats.


The frontend now accumulates raw accepted letters in an editable sentence draft. Word spaces are manual, and only Enter/Send invokes persistence, composition and speech. Hands-down events only finish recognition segments. Dictionary-derived word tokens cannot replace the draft. Stop/reconnect preserve it; clear discards it; failed sends keep it; duplicate Enter is blocked while saving. Accepted-letter partial confidence now uses the minimum native confidence over its hold, matching final recognition tokens. No commands or wire fields were added.

# Current runtime update (2026-10-23)

The user approved a learner-friendly one-second steady hold after observing transition letters in live testing. Movement and evidence gaps restart the hold; a brief detection dropout does not duplicate a held letter. Accepted raw spelling and tentative guesses are separate in the browser via optional `sign.partial.acceptedGloss`. Commands and message types remain protocol v1.

The inactive original-CNN comparison code/weights, dynamic vocabulary remnants and CUDA/PyTorch/Transformers dependencies have been removed. The fixed A-Z advertisement is retained for protocol compatibility. Fresh-computer setup, direct webcam tests and real WebSocket startup are documented in [the service README](../../apps/sign-service/README.md).

Current priority-video reevaluation: raw/backend `K`, expected `OPENTHEBOOK`, FAIL. Report: ignored `.data/open-book-one-second-report.json`. The clip does not supply continuous one-second stable evidence for most letters.

Current verification: 50 Python tests and 22 browser/client tests pass; Ruff, all workspace type checks, contract fixtures and git diff checks pass. A fresh Python 3.12 runtime environment installs from the lean lock without development/training dependencies; the bundled model and MediaPipe tracker initialize. A repeated stationary diagnostic image over the real WebSocket produces accepted `L`, one `L` token and one phrase completion without errors. This is a synthetic hold/execution check, not live recognition accuracy. A wheel and sdist build successfully with the numeric model asset and license. Independent review found and resolved low-FPS continuity; negotiated cadence now controls the gap allowance.

The results below predate the one-second hold and are historical evidence only. Short-hold recordings must be reevaluated; they cannot be represented as passing the current learner-oriented runtime.

# Alphabet pipeline implementation and evidence

Updated 2026-10-23. Latest user scope: use any internet model/means to make at least `open_the_book.mp4` work; backend processing is explicitly allowed. This supersedes both the old dual-model plan and the later emnikhil-only restriction.

## Historical four-frame result

| Clip | Expected letters | Raw visual letters | Backend letters | Text | Backend pass | Raw pass |
| --- | --- | --- | --- | --- | --- | --- |
| open_the_book.mp4 | OPENTHEBOOK | OPENTHEBOK | OPENTHEBOOK | OPEN THE BOOK | YES | NO |
| hello_i_am_tushy_baby.mp4 | HELLOIAMTUSHYBABY | HELEOIAMEKXSRESHYEWBABY | same as raw | same as raw | NO | NO |

The repeated O is restored by a general English frequency decoder. This is explicitly language-assisted recognition. Raw visual repetition is unresolved. No overall sign-service recognition completion or human signoff is claimed.

Input SHA-256: open `3c516bac095b9c9fa40f9d601771ad026b759962d2c396e73a3aae7dd08abc31`; hello `9eff3543d5af30cf3787930963ec58dadaa24d10a4824b539e7d66736a4c0d10`.

## Implementation sequence and decisions

1. Reproduced the requested emnikhil app's exact image/cascade behavior (main CNN plus three specialists, fixed mirrored ROI, raw pixels). Its reference path is retained, but it did not meet the video objective.
2. Researched public ONNX, PyTorch and TFLite landmark classifiers. These improved background independence but had orientation/confusion problems. Cached probes are diagnostic, not acceptance success.
3. Trained one ExtraTrees alphabet model exclusively on the pinned public CSV from [Muhib-Mehdi/ASL-Recognition-System](https://github.com/Muhib-Mehdi/ASL-Recognition-System/tree/a66dd63ad597a023941f5ad90603aa267767d2ed): 36,401 one-hand samples, mirror augmentation, 42 pixel-normalized coordinates +210 pair distances. No acceptance video is used for fitting.
4. Exported numeric-only forest arrays; preserved source license/provenance and pinned asset hash. Added reproducible training/export module with optional locked training dependencies. Runtime requires only NumPy for classification.
5. Switched full-frame tracking to the full MediaPipe hand model. Removed the fixed camera box from the active UI and tracker.
6. Kept one stability stage (four fresh observations), native probabilities, per-connection phrase state and ~one-second observed hands-down boundary.
7. Added backend-only English decoding that can insert adjacent repeats and spaces, but cannot replace/delete observed letters or insert other letters. It uses a general frequency dictionary, not demo phrases. Raw spelling remains available in reports and webcam preview.
8. Emit decoded words as ordered FINGERSPELL tokens through existing protocol v1. Reuse existing compose, persistence and speech boundaries.
9. Verify offline video output, actual real-time WebSocket replay, existing demo compose/audio, unit tests and model export parity. Leave other-video and live-owner acceptance open.

## Reproduction and evidence

```powershell
bun run sign:verify --offline
bun run sign:eval apps/sign-service/test_data/open_the_book.mp4 --offline --report .data/open-book-final-report.json
bun run sign:eval --offline --report .data/landmark-language-video-report.json
bun run sign:camera
bun run sign:dev
bun run sign:test
```

The evaluator JPEG-encodes sampled frames (~12 fps), uses the production recognizer/decoder, then reads filename targets for scoring. EOF explicitly flushes the final phrase. The priority test reports both raw and assisted output; running both clips returns nonzero because hello still fails. The tested clips were repeatedly used to select/check candidates, so these are development acceptance results, not an independent generalization benchmark.

Actual WebSocket replay at capture speed emitted `OPEN`, `THE`, `BOOK`; exactly one `phrase.end`; zero protocol errors. Token confidence stayed ~0.19346, the minimum native confidence over the raw spelling. Evidence: ignored `.data/open-book-websocket-report.json`. Real word tokens then passed through the configured mock backend: `OPEN THE BOOK.`, WAV content type, 23,858 audio bytes; the temporary verification session was deleted. Evidence: `.data/open-book-compose-report.json`. This does not establish real-provider speech quality.

Synthetic numeric-model execution: one alphabet classifier, CPU, median ~0.23 ms, 19,815,348-byte compressed asset; capture/tracking excluded. Export matches original sklearn probabilities on 128 deterministic independent vectors within 5e-8, with identical labels. Asset/data hashes and training parameters live in `assets/landmark_forest/metadata.json`.

Regression coverage includes numeric traversal/mean probabilities, training/inference feature transforms, coordinate translation/scale, mirror-invariant shape distances, conservative language decoding and unknown-spelling controls, native confidence, isolated streams, safe protocol errors, throttling, reset/stop fencing, fresh observations and word ordering. The protocol recovery test now waits for actual tracking rather than depending on a five-frame burst surviving intentional coalescing; assertions are preserved.

## Terminology and limitations

- **Raw letters:** stable visual classifications before language processing.
- **Backend-decoded text:** general English reconstruction, including possible repeat restoration and spaces.
- **Alphabet model:** one 26-class forest; MediaPipe is its hand landmark extractor, not a lexical classifier.
- **Reference camera:** historical original emnikhil cascade, invoked explicitly; inactive in production.

The low confidence floor (0.15) permits stable but uncertain native predictions. English priors can alter ambiguous repeats/names; unknown spellings remain unsupported when no full dictionary path exists. J/Z are treated as posed alphabet classes, not fully validated motion recognition. The hello clip, real webcam reliability, arbitrary-user generalization, both-owner demo trials and full M2 recognition signoff remain open. No percentage/trial requirement was added.


Historical automated checks: 54 Python tests passed (two pinned MediaPipe/protobuf deprecation warnings); Ruff passed; 20 browser/live-client tests passed; all eight workspace type checks passed; fixture validation passed; git diff --check passed. A rebuilt wheel contains the current numeric model, provenance/license and active runtime modules with byte parity to source. Independent review found no material correctness issue or filename/training leakage.
