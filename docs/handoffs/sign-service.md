# Sign service handoff

> Current runtime: one CPU A–Z landmark classifier, movement suppression and a one-second letter hold. Legacy CNN/word-model code and CUDA dependencies are removed. Previous four-frame video results below are historical: the current priority-video reevaluation returns K and fails. See the [fresh setup and testing guide](../../apps/sign-service/README.md).


Updated 2026-10-23. Original implementation: `38ca735`; original handoff: `8e416a0`.
Owner: Harnoor. Runtime: `apps/sign-service`. Authoritative protocol: `packages/contracts/src/protocols/sign-service.ts` and generated JSON Schemas.

## Completion follow-up

The original handoff implemented a model-only pretrained alphabet/WLASL pipeline but left accuracy, performance and fresh-machine verification open. The completion work fixes malformed-command crashes, per-client state isolation, blocking reset behavior, lost repeated letters, status throttling, stale/cached inference evidence, optimistic readiness and browser reconnect/deduplication.

The active design shares weights only, gives each connection its own tracker/history, and serializes GPU inference through a bounded latest-input scheduler. Tracking does not wait for inference. Four fresh stable observations commit a token; generic letters assemble without acronym maps. Model confidence is not renormalized over the small demo vocabulary. Unsupported/ambiguous predictions abstain.

## Reproducible setup

Use Python 3.12, uv, the committed CUDA lockfile and Bun 1.4.4. No manual pip uninstall/reinstall sequence is needed.

```powershell
bun run sign:setup
bun run sign:verify --offline
bun run sign:verify --offline
bun run sign:test
bun run sign:dev
# Second terminal:
bun run sign:camera
```

A fresh-cache run must use an empty directory; for another cold run choose a new `--cache-dir`, then use that same directory for offline verification. Caches and reports are ignored local artifacts. Full details, revision IDs and configuration are in [service README](../../apps/sign-service/README.md).

## Capability boundaries

The current alphabet checkpoint exposes A-Z. The video checkpoint exposes 2000 labels but only supported Sightline lexical labels are advertised/emitted. FORMULA and BOARD are not in its trained label map; spell unsupported words generically. Arbitrary names/acronyms are handled the same way as other spellings. Held letters do not repeat; release between consecutive identical letters.

Retain automatic switching, no prototype calibration, no project-specific training, no handcrafted ASL/acronym mappings. A replacement pretrained model requires pinned revisions, verified processor/tensor/label compatibility and evidence supporting the change.

## Evidence and remaining acceptance

The original RTX 5060 / 8 GB measurements are historical and are not evidence for this workstation, which has RTX 3050 / 4 GB. Blank-image execution and schema tests never establish real signing accuracy. Current verification results, architectural decisions and open acceptance items are recorded in [implementation record](../implementation/sign-service-plan.md).

Verification completed: 31 Python tests, browser lifecycle tests, all workspace type checks, fixture checks, real-service readiness/JPEG smoke and all six fixture-to-compose/audio sequences. Offline RTX 3050 execution used CUDA FP16; median alphabet/video/no-hands tracking times were 18.41/110.19/15.13 ms, peak PyTorch allocation 414.93 MiB. The full backend suite retains one independently reproduced baseline glossary fallback failure; real-provider smoke lacks credentials.

Owner acceptance remains the original checklist: the six demo phrases reliably recognized from at least two team members, M2 webcam → real service → web → mock compose/tone, and correct reset/stop. Unsupported words may be fingerspelled. No additional trial counts or numerical accuracy threshold were approved. Do not call recognition complete before those observations exist.
