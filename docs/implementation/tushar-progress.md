# Tushar implementation ledger

Plan: the full P0/P1 implementation approved in this conversation on 2026-10-22.

## Decisions

- Work in the existing sightline checkout, as explicitly approved. The original task did not authorize the agent to create branches or commits; this was not a prohibition on maintainers subsequently committing/merging the work.
- Keep public engine and JSON contracts unchanged. Extend internal ports for durable jobs and asset ownership.
- Durable jobs use Postgres with a memory adapter for mocks. Source assets are persisted before accepting uploads.
- Private assets use the existing cookie resolver and session ownership check.
- Qdrant indexes publish through versioned collection aliases; notes remain transcript-led.
- Docker is the supported runtime for real document conversion. OCR is excluded.
- Preserve all mock switches. Historical OpenAI defaults were superseded by the merged Merge Gateway/Gemini configuration; see the current operations guide.

## Checklist

- [x] Persistence and auth implementation
- [x] Recoverable jobs
- [x] Private assets and slide conversion implementation
- [x] Qdrant knowledge and slide pointer implementation
- [x] Grounded notes and board markers
- [x] Integration, migration, and operational documentation
- [x] Independent read-only review and regression fixes
- [ ] External-service acceptance and latency measurements (environment prerequisites unavailable)

## Verification record

- Initial checkout clean; no existing test files. Bun 1.3.10 installed.
- Docker daemon was unavailable during planning.
- Initial dependency install failed creating workspace links in the sandbox; retrying with elevated filesystem access.
- Dependency installation succeeded outside the sandbox. Server now declares direct Mastra, Qdrant, OpenAI and Drizzle dependencies; fflate is test-only.
- First three regression tests failed on caption downgrades, timestamp ties and gaze-zone splitting, then passed after fixes.
- Full mock REST/WebSocket smoke passed, including slide assets, captions, slide pointers, TTS, notes, export and deletion.
- Final smoke rerun under pinned Bun 1.4.4 passed after all code changes; final workspace type checks, server build, fixture validation, Compose configuration and git diff whitespace checks passed. Temporary validation servers were stopped.
- Workspace type checks, server build and fixture validation passed.
- Windows Varlock shim crashed under both Bun 1.3.10 and temporary 1.4.4. Running its Node CLI before Bun successfully started the server; no global runtime was changed.
- Smoke testing exposed public BETTER_AUTH_URL being classified as sensitive; corrected the schema rather than disabling leak detection.
- Independent read-only review identified crash-attempt overflow, expired-lease cancellation, alias publication fencing, ambiguous alias-response cleanup, container Qdrant routing, empty-index dimensionality, and staged-file cleanup. Fixed these and added recovery/publication regressions.
- Final combined Bun 1.4.4 suite: 25 passing, 4 skipped, zero failures (94 assertions). Tests include the actual Mastra workflow with controlled model outputs and every range of a two-hour transcript.
- A temporary portable Postgres 18 cluster under ignored .data/validation enabled real database checks without a system service: migrations applied twice, adapter recreation, ownership, caption precedence, disk restart/cleanup, queue claims/retries/publication locks, two-user signup/login/logout, and cookie-authenticated WebSocket isolation all pass.
- Bun 1.3.10 on this Windows host hangs on the revoked-cookie integration test; the same test completes under Bun 1.4.4. Pinned the tested runtime in packageManager and server images; the global installation was not modified.
- Docker Desktop startup did not produce a daemon in either configured context. Real Qdrant, complete PDF/PPT/PPTX conversion and paid provider checks remain opt-in and unexecuted. A native PDF attempt rendered the page but could not complete extraction because this host bundles pdfinfo/pdftoppm without pdftotext. No live-provider latency claims are made.

## Rulings

- The original agent left reviewable changes without creating commits/branches. Maintainers subsequently committed/merged them; this is expected, not a policy violation.
- Make the first migration idempotent for the prior db:push scaffold, including notes_error adoption; custom divergent schemas still need operator inspection.
- Fence external publication under the same per-session lock as deletion and revision changes. Reconcile ambiguous alias responses before deleting candidate collections.
- Historical choice: store bytes in hashed session directories. Superseded by the merged ObjectStorage keys (`assets/<sessionId>/...`, `recordings/<sessionId>/...`); see the current operations guide and review follow-ups for durable object cleanup.
- Document a precise operator requeue for terminal cleanup jobs after the configured three attempts. Automatic retries remain bounded.
- Pin Bun 1.4.4 based on reproducible real-auth integration evidence. The Windows Varlock helper issue is separately documented; production images use the tested runtime.

## Review scope

The reviewer deliberately accepted ephemeral memory jobs, ownership checks before asset reads, preservation of prior notes, terminal empty-transcript errors, no OCR, and development-only dev routes. Those match the approved scope. Service-backed acceptance remains pending rather than inferred from deterministic tests.
