# Tushar review follow-ups — 2026-10-22

Source: [Ashwath's review](../owners/tushar.md#review--2026-10-22-ashwath-against-originmain--03a6fc3).

## Execution checklist

- [x] Persist snapshots and recordings, strip playback URLs, enforce session isolation, and generate a forward migration.
- [x] Share deterministic snapshot placement between real/mock notes, including time fallback; reject invented images.
- [x] Normalize absent nullable model fields without relaxing source validation; verify gateway latency budgets and embedding dimensions.
- [x] Move converter dependency failures to the affected upload, not server startup; remove obsolete Qdrant pointer code.
- [x] Export authorized snapshot images without requiring cookies; retain private stored notes and assets.
- [x] Align Bun images and update ownership/operations/deployment/progress documentation.
- [x] Run deterministic, Postgres, smoke, build/type checks, and available real-service acceptance; record unavailable prerequisites honestly.
- [x] Independent final read-only review and regression fixes.

## Decisions

- Ruling: work in the explicitly requested existing checkout; no branch, commit, push, or deployment is authorized by this task. Historical commits were made separately and are not a standing prohibition on maintainers committing.
- Preserve the merged Merge Gateway / Gemini / ObjectStorage implementations rather than redo resolved review items.
- Model-only schemas may normalize omitted/null optional values, but public contracts, citations, formulas, and asset ownership remain strict.
- Markdown export will embed authorized raster snapshot bytes as data URLs. This avoids expired links and cookie requirements; renderers that prohibit data URLs may not display them. Stored notes retain private API URLs.
- Bun 1.4.4 remains the tested baseline because 1.3.10 previously hung on revoked-cookie tests; align the web builder rather than downgrade the server.
- Ruling: include the two pre-existing storage-cleanup hazards found in final review because the new persistence cascade would otherwise discard recording cleanup metadata and transient S3 errors would lose asset ownership indexes. Known recording keys are captured under the deletion lock, deleted immediately, and retained in a durable second pass after the upload URL lifetime plus a five-minute grace period. Each pass has bounded retries. Cost/limit: an exceptionally long already-started S3 PUT can outlive that grace; retain job payloads and requeue the final cleanup after it completes. This is not immediate revocation of previously issued S3 capabilities.

## Verification

- RED: real Postgres snapshot and recording tests failed on the reviewed `NOT_IMPLEMENTED` methods; after implementation and migration both pass, including repeat migration execution, adapter recreation, cross-session ID collision protection and deletion cascades.
- RED: real notes rejected omitted fields and accepted invented images; caption-time placement used the wrong section. All these regressions now pass; two-hour bounded workflow regression remains green.
- RED: glossary rejected omitted definitions/aliases/topics. Normalization and empty 768-dimensional index tests now pass.
- RED: model ignored the configured per-call deadline; slow local gateway now aborts. Local compatible-embedding transport test verifies float encoding/dimensions.
- RED: missing converters left slides processing/retrying; failures are now terminal, retrievable and upload-scoped. Export lacked private cache headers and cookie-independent images; authenticated portable export passes without mutating stored notes.
- Full backend suite: 81 pass, 14 opt-in skips, 0 failures. Live-client: 13 pass, 0 failures. Temporary Postgres platform suite: 39 pass, 4 external skips, 0 failures; includes two-user auth/WebSocket isolation and deletion-fenced recording writes.
- All workspace type checks, server build, fixture validation and full mock REST/WebSocket smoke passed. Mock smoke included snapshot placement, recording upload/playback, notes export and deletion; server ran without provider credentials.
- Bun 1.4.4 registry manifest exists. Docker daemon is unavailable, so no container build or Qdrant/converter acceptance was claimed. Merge/Gemini keys are missing in this checkout; no real-provider calls or latency/quality claims were made.
- Windows Varlock helper still asserts after successful code generation; regenerated types type-check. An absolute local storage directory was needed for reliable concurrent seed writes on this host.
- Server health succeeds with real slides enabled and missing converters, proving the upload-scoped dependency check no longer blocks startup.
- Final independent review: no new blocker in persistence, schemas, placement or export. Two important pre-existing cleanup hazards were reproduced RED, then fixed: failed-first asset deletion keeps its index; recording deletion captures keys before cascade, retries outages and removes simulated late uploads in a delayed pass. Both memory and recreated Postgres repositories preserve scheduled payloads. Recording writes now take the same session deletion lock (RED → GREEN).
- Review boundaries: live-provider quality/latency and Docker/converter acceptance remain unavailable, not inferred. Custom divergent database schemas require operator inspection. Raster-only exports are deliberate. Broader pre-existing concurrent recording reservation/read-modify-write semantics remain with the shared recording service owner; this task fences persistence against deletion but does not redesign that API.
