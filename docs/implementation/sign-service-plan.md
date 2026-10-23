# Sign-service implementation plan and execution record

> Current runtime: one CPU A–Z landmark classifier, movement suppression and a one-second letter hold. Legacy CNN/word-model code and CUDA dependencies are removed. Previous four-frame video results below are historical: the current priority-video reevaluation returns K and fails. See the [fresh setup and testing guide](../../apps/sign-service/README.md).


Approved 2026-10-23. Baseline: 8e416a0 (implementation 38ca735).

## Goal and acceptance
Complete Harnoor's owner brief and M2: real webcam recognition to browser, compose and speech. Keep protocol v1, pretrained-only automatic recognition, generic fingerspelling, no prototype calibration or acronym rules. Target RTX 3050 4 GB. Keep tracking near 60 ms and infer asynchronously; aim for token updates about one second after completed signs. Two team members must verify the six documented phrases reliably, allowing unsupported words to be fingerspelled. No invented trial counts or percentage thresholds.

## Implementation sequence
1. Reproducible Python 3.12/uv/CUDA dependencies, pinned checkpoints and fresh/offline model verification.
2. Share weights only; isolate trackers/windows; bounded latest-input GPU scheduling and generation fencing.
3. Correct stability, release/repeated letters, confidence, abstention and phrase ordering.
4. Protocol validation/readiness, <=5 Hz status, reset/stop/cleanup regression tests.
5. Browser readiness, visible errors, reconnect/resume and duplicate prevention.
6. Synchronize docs and run automated, GPU and M2 checks; leave human recognition acceptance open until observed.


## Implementation map
| Work | Main files | Result |
| --- | --- | --- |
| Setup and model verification | sign-service pyproject.toml, uv.lock, verify_models.py; scripts/sign-service.ts | Frozen setup and actual offline CUDA FP16 execution verified |
| Shared weights and isolated streaming | hf_pipeline.py, recognizer.py, scheduler.py | Per-stream trackers/history; one fair latest-input GPU queue; reset/stop generation fencing |
| Recognition and commitment | arbitration.py, decoding.py, types.py | One stability stage; honest confidence; generic/repeated spelling; ordered phrase completion |
| Protocol and resource lifecycle | server.py; Python tests | Malformed input recovery, throttling, unavailable tracker/model reporting and cleanup verified |
| Browser integration | sign-service-controller.ts, use-sign-service.ts, sign-panel.tsx | Readiness/errors, source preservation, reconnect intent and duplicate completion tested |
| Compose/audio and owner handoff | scripts/check-sign-compose.ts; READMEs, overview, owner brief, handoff | Six fixture-to-compose/audio checks pass; live M2 and two-signer acceptance remain open |

## Audit
Confirmed malformed type/source exceptions, shared pipeline history, synchronous reset blocking, repeated letters lost, cached predictions counted again, status changes bypassing throttle, optimistic readiness, browser reconnect missing stream.start. WLASL lacks FORMULA/BOARD. Two focused compose tests and fixture validation passed during planning; broader tests stalled under Bun 1.3.10. Bun 1.4.4 is the repository verification runtime.

## Decisions
- ADR S1: exact user-requested worktree path overrides native tool placement, which cannot choose that path.
- ADR S2: shared immutable model weights, per-connection temporal state, one bounded GPU worker. No global tracker or frame history.
- ADR S3: generated contracts remain the boundary. Changes are internal and documentation-only at the public protocol.
- ADR S4: recognition evidence is separate from synthetic CUDA/protocol checks. Failed acceptance is reported rather than hidden by mocked output.

## Glossary
- Observation: a fresh captured/tracked frame and its identity; reusing inference is not new evidence.
- Generation: stream epoch invalidating results after reset, stop or reconnect.
- Gloss: uppercase recognized lexical sign or assembled fingerspelled word.
- Phrase: ordered committed tokens ending after approximately one second of observed hands down.
- M2: real sign recognition integrated with the browser and mocked compose/tone backend.

## Execution ledger
Plan source: the user-approved plan in this chat. Execute inline; no commits or push requested.
Pre-flight: tracking produces immutable snapshots; shared inference consumes snapshots; the phrase decoder alone commits tokens; the browser submits phrase token IDs once.

- Final regression coverage: 31 Python tests (including 16 protocol cases), 7 browser lifecycle tests, shared-client/caption checks and real-service smoke. See the verification ledger below.
- Ruling: WebSocket tests send additional frames because the approved latest-frame policy may drop frames; four transmitted frames do not guarantee four processed observations.

- Review: fresh reviewer identified delayed duplicate completion, async final evidence lost at hands-down, message-batch interleaving, reconnect UI intent, and pending-queue fairness. Added failing reproductions and fixed them. Decoder hand transitions now drain fresh outstanding pre-release evidence; a transition lock serializes whole message batches. Inference observation waits are bounded to one second.
- Final failure-path follow-up: a tracker constructor exception now reports MODEL_UNAVAILABLE and retains command validation rather than closing with 1011; a failing regression proved the gap, and the full 31-test suite passes after the fix. React effect cleanup also fences callbacks from a disposed socket so they cannot overwrite a newer connection.
- Ruling: retain protocol v1. Server reset fences apply upon command receipt; already-transmitted messages cannot be recalled without an acknowledgement/generation protocol extension. No new reset wire fields were approved.
- Dependency recovery completed: default uv downloads repeatedly stalled; resumable public wheel range requests worked. All downloaded wheel SHA-256 values matched uv.lock, installation used uv, and frozen sync passed. Exact verified CUDA versions are pinned in pyproject.toml and uv.lock. Bun 1.4.4 installation completed. Varlock reports its pre-existing Windows UV_HANDLE_CLOSING after writing generated files; the resulting workspace types pass.
- Fresh model downloads completed into the initially empty project .cache/huggingface. JSON Git-blob hashes and safetensors LFS SHA-256 values matched the pinned upstream metadata. Cached offline execution then passed. The completed execution report correctly records fresh_cache=false: download recovery populated the cache before the offline command, rather than invoking the CLI fresh-cache flag.

## Ownership and contract reconciliation
The ownership source is `docs/owners/harnoor.md`, alongside `docs/00-overview.md` and `docs/handoffs/sign-service.md`; this checkout contains no separate OWNERS/CODEOWNERS file. Harnoor owns recognition, vocabulary, spelling and phrase segmentation. Browser capture/presentation belongs to Sahil, sentence composition and speech to Ashwath. Browser changes here repair the recognition integration; compose/persistence/TTS implementations remain unchanged.

Protocol version 1, command/message discriminants and token fields remain unchanged. Generated JSON schemas were regenerated and byte-normalized back to the repository checkout format; there is no schema diff. Python WebSocket tests require the generated schemas and validate every observed service message. Recognition vocabulary comes from the pinned label maps, while generic fingerspelling extends it to arbitrary words.

## Verification ledger
- Bun 1.4.4: browser controller, realtime caption state and shared live client: 25 tests passed. Workspace type checks: all eight workspaces passed.
- Fixture validation passed: six sign phrases and all other shared fixtures.
- Mock backend smoke passed: REST, WebSockets, sign composition, served WAV audio, snapshots, recordings, notes and cleanup. All six sign fixture sequences also passed the dedicated compose/audio check, including fingerspelled FORMULA/BOARD and PEER source.
- Full backend unit suite: 100 passed, 14 skipped, one failed in platform/knowledge (failed-LLM fallback chooses Kirchhoff/KCL rather than expected Ohm's law). The untouched original checkout reproduces the same failure under Bun 1.4.4. This unrelated baseline failure is not repaired in the recognition change.
- Real provider smoke is unavailable: the original checkout has no server `.env`, and none of the documented provider keys are configured in the process environment. The verification backend uses explicit mocks.
- Python: `bun run sign:test` passed all 31 tests in the final locked environment. Ruff lint and changed-file formatting checks passed. The two warnings come from pinned MediaPipe/protobuf and concern Python 3.14; this service targets Python 3.12.
- CUDA: `bun run sign:verify --offline --iterations 10` passed with actual pinned weights and checkpoint processors. See measurements below.
- Real service smoke passed: schema-valid readiness with 49 labels, malformed-command recovery, invalid JPEG handling, actual no-hands tracking, reset and stop. The running browser automatically changed from offline to Recogniser connected and enabled Start after the real service became usable. No camera permission or live signing was used.
- Server build and `git diff --check` passed. No public schema changes were generated.


## RTX 3050 execution evidence
Measured 2026-10-23 with Python 3.12.4, PyTorch 2.11.0+cu128, torchvision 0.26.0+cu128 and Transformers 4.57.6; NVIDIA RTX 3050 laptop, 4096 MiB, driver 610.60. Checkpoints use their pinned slow processors explicitly (`use_fast=False`). These are ten synthetic blank-image iterations after startup validation and three additional warmups, not a recognition benchmark.

| Stage | Median ms | P95 ms |
| --- | ---: | ---: |
| Alphabet | 18.41 | 45.68 |
| 16-frame video | 110.19 | 115.84 |
| JPEG decode + no-hands tracking | 15.13 | 34.46 |

Actual processors: SiglipImageProcessor and VideoMAEImageProcessor. Actual label counts: 26 and 2000; video config requires 16 frames. Pixel tensors were `[1,3,224,224]` and `[1,16,3,224,224]` on cuda:0; both models' parameters and output logits were torch.float16, with CUDA FP16 autocast enabled. Native confidences were preserved; the unsupported blank-video winner (`tall`) abstained.

PyTorch allocated 368.60 MiB, peak allocation 414.93 MiB, reserved 450.00 MiB. Whole-device usage with the warmed service/browser running was 611 MiB, including other processes; Windows reports per-process nvidia-smi memory as N/A. The local detailed report is `.data/sign-model-report.json` (ignored generated evidence). Real-hand tracking and completed-sign-to-token timing remain unmeasured.

Verified advertised support is A-Z plus these 23 lexical labels: AGAIN, EXAMPLE, HELLO, HELP, HOW, ME, MEANING, NAME, NO, NOT, PLEASE, QUESTION, REPEAT, SLOW, SORRY, THANK-YOU, UNDERSTAND, WHAT, WHERE, WHY, WRITE, YES, YOU. FORMULA and BOARD require generic spelling. Label presence establishes classifier support, not recognition reliability on the owners' signing.

## Live recognition acceptance record
Not yet observed. A camera check requires the two team members' signing; no synthetic input or fixture-to-compose check fills these cells. Record signer names, observed gloss order, spelling/repetition, composed sentence/audio, timing and failures when running the owner check.

| Demo phrase | Team member 1 | Team member 2 |
| --- | --- | --- |
| PLEASE REPEAT FORMULA | Unobserved | Unobserved |
| QUESTION KCL MEANING WHAT | Unobserved | Unobserved |
| SLOW PLEASE | Unobserved | Unobserved |
| BOARD WRITE AGAIN | Unobserved | Unobserved |
| HELLO ME NAME RIA | Unobserved | Unobserved |
| THANK-YOU | Unobserved | Unobserved |

M2 live webcam → recognizer → browser → mock compose/tone and the approximate one-second token latency remain open until observed. Repeated letters, release behavior, reset/stop and reconnect are covered by automated regressions, with the live behavior still to be checked by the owners.

Final handoff: the narrow follow-up review found no actionable issues in constructor-failure handling or disposed-socket callback fencing. Temporary verification services and the browser tab were stopped. Changes remain local on codex/harnoor-sign-service in the requested isolated checkout; the original checkout remains clean.
