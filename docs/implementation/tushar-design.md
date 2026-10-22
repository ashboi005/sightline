# Tushar platform design

## Goal and boundaries

Complete sessions, auth, persistence, private assets, PDF/PPT/PPTX conversion, lecture-context retrieval, grounded notes, slide pointers and board markers. The existing contract package remains the wire-format authority. Frontend, recognition, speech providers and deployment remain with their documented owners.

## Architecture

The Elysia application composes platform adapters around SessionStore, KnowledgeEngine and NotesEngine. Postgres stores lecture state and a small durable queue; memory equivalents preserve zero-service mock development. The job runner lives in the same server process and processes at most two sessions concurrently. Jobs serialize within a session. Queue publication and visible database state changes share transactions.

Uploads persist source bytes before jobs are accepted. Assets belong to sessions, and the route resolves the signed-in user and session ownership before reading bytes. Disk metadata is stored in Postgres and source/image/audio bytes in STORAGE_DIR. Cleanup records survive session deletion so external resources can be retried.

Knowledge ingestion builds a new Qdrant collection, generates a glossary and switches the ctx_<sessionId> alias. Retrieval and glossary state remain per-session. Glossaries hydrate from Postgres at startup; live getGlossary calls use memory only. Model and embedding calls have bounded requests. Query caches are bounded and expire.

Notes use an explicit Mastra outline/write/assemble workflow. Transcript partitions bound context size and section writing has concurrency two. Citation IDs and slide indexes are validated against source inputs, formula blocks must exist in caption parts, and Markdown is rendered from the structured result. Context-only supplements receive explicit labels. Board time is computed from the union of actual source/BOARD overlaps.

## Defaults and failure behavior

- Existing configurable OpenAI model defaults; no provider keys required by mocked engines.
- Qdrant pointer confidence 0.5 and switching margin 0.1.
- A section is board-heavy at ten seconds of BOARD overlap.
- Three transient attempts, renewable 60-second leases, 15-second heartbeats; terminal document/empty-transcript validation errors do not retry.
- Existing notes remain readable while regeneration runs or fails.
- Docker supplies Poppler, LibreOffice and fonts. Image-only pages render without OCR.
- Real auth uses HTTP-compatible development cookies and secure production cookies.

## Acceptance

Verify memory/Postgres parity, user isolation, restart recovery, lease fencing, replacement/deletion races, real converter output, real Qdrant retrieval, and schema-validated notes. Preserve the existing mock REST/WebSocket smoke test. Measure service targets separately from deterministic tests; report unavailable external-service checks explicitly.
