# Running Tushar's platform

## Mock development

Install with `bun install`, copy `apps/server/.env.example` to `apps/server/.env`, and run `bun run dev:server`. All mock flags inherit `USE_MOCK_DATA=true`. No AI key, Qdrant or Postgres connection is used by the mocked platform. The better-auth signup screens still require a database, as before.

Use the pinned Bun 1.4.4 runtime. Real Postgres/auth/WebSocket integration passes with 1.4.4; Bun 1.3.10 on this Windows host hangs during the revoked-cookie test. You can invoke the tested runtime temporarily with `bun x --package bun@1.4.4 bun ...` without changing the global installation.

On Windows, Varlock 1.18.0's executable shim can terminate with `UV_HANDLE_CLOSING`. The verified server-start workaround from `apps/server` is `node ../../node_modules/varlock/bin/cli.js run -- bun src/index.ts`. On this host, code generation writes its output successfully but the helper may still exit abnormally; inspect its diagnostics and run type checks. The Docker path avoids this Windows-specific helper problem. Public server/auth URLs and allowed origins are intentionally marked public in the schema, while secrets remain sensitive.

## Docker-first real platform

`docker compose -f docker-compose.platform.yml up --build` starts Postgres, Qdrant and the server with real persistence and converters, while retaining mock speech/captions/knowledge/notes. The development image applies versioned migrations before startup. It includes Poppler, LibreOffice and fonts. Source files and rendered assets persist on the uploads volume.

To enable actual AI engines, set `MOCK_KNOWLEDGE=false`, `MOCK_NOTES=false`, `MERGE_GATEWAY_API_KEY`, and `GEMINI_API_KEY` in `apps/server/.env`. Keep `MOCK_SPEECH=true` and `MOCK_CAPTIONS=true` to exercise the platform independently with replay. Chat defaults to `LLM_MODEL=zai/glm-5.3-flash` through Merge Gateway. Embeddings use `GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `EMBEDDING_MODEL=gemini-embedding-001`, and `EMBEDDING_DIMENSIONS=768`, with float encoding. Re-ingest every session after changing embedding model/dimensions. `PLATFORM_LLM_TIMEOUT_MS=45000` bounds each glossary/notes call (integer 1–120000); two section calls run concurrently, so this is not an end-to-end SLA. To test real login, set `MOCK_AUTH=false` and register a user. Never deploy the development secret or mock auth configuration publicly.

When running Bun outside Docker, `bun run infra:up` supplies the database and Qdrant. Run `bun run db:migrate` with DATABASE_URL configured, then start the server. Real conversion additionally requires `pdfinfo`, `pdftoppm`, `pdftotext`, and `libreoffice` on PATH; Docker is the supported converter runtime.

Missing converters no longer stop server boot. An upload needing a missing converter becomes `FAILED` with an actionable GET slides error; PDFs do not require LibreOffice. Use an absolute `STORAGE_DIR` on Windows: Bun failed during concurrent seed writes with a relative `../..` path on this host, while the absolute path succeeded.

Assets use `ObjectStorage`: local disk for development, private S3/R2/MinIO in production. Ownership metadata remains in `platform_asset`; authenticate and authorize before presigning downloads. See [deployment](../deploy.md) for bucket CORS and credentials. Local storage needs a persistent volume; S3 needs bucket backups instead of a server asset volume.

## Migrations and upgrades

The initial versioned migration creates both better-auth and lecture tables. It is intentionally idempotent for the previously documented `db:push` scaffold: table/index creation and foreign-key installation tolerate existing definitions, and the new notes_error column is explicitly added when absent. Back up existing data, stop the server, configure the same DATABASE_URL, and run `bun run db:migrate`. Do not delete existing tables or volumes and do not re-run `db:push` as a deployment step. This upgrade assumes the earlier scaffold's column definitions; inspect custom schema divergence before applying it. Subsequent schema changes use `bun run db:generate` and reviewed forward migrations.

The forward `20261022135716_snapshots_recordings` migration adds both tables, cascading session foreign keys and timeline indexes. Apply it before snapshots/recordings or real-persistence notes. Equivalent development scaffold tables/indexes are tolerated. Signed recording playback URLs are never persisted.

## Portable notes export

Stored notes retain private `/api/assets/:id` URLs. Authenticated Markdown export embeds only snapshots belonging to that session and backed by its asset ownership metadata, as PNG/JPEG/WebP data URLs. Exported files contain private image bytes: share deliberately. No cookies or expiring links are needed, but some external renderers disallow data URLs. Combined unique raster bytes are capped at 20 MiB; missing, unsupported or mismatched assets fail explicitly. Export never mutates stored notes. Both asset and export responses use `private, no-store`.

## Recovery and cleanup

Jobs are claimed with renewable leases and serialize within a lecture. Transient failures retry three times; converter/empty-input validation failures are terminal. Poll the existing slides/context/notes routes for results. Failed notes include an error and retain the last successful notes. Retry notes through the existing regenerate endpoint, slides by uploading again, and context by setting text again.

Session deletion cancels existing work, removes database lecture rows, and queues external cleanup. Cleanup jobs deliberately do not have a cascading session foreign key. If Qdrant is down, cleanup retries rather than silently succeeding. Check server job logs and platform_job rows for terminal failures. Preserve database metadata together with local-volume or object-bucket backups; local deployments must share the asset volume.

After fixing an outage, an operator can requeue a specific terminal cleanup job with `UPDATE platform_job SET status = 'PENDING', attempts = 0, token = NULL, lease_until = NULL, available_at = (extract(epoch from clock_timestamp()) * 1000)::bigint WHERE id = '<failed cleanup job ID>' AND kind = 'CLEANUP' AND status = 'FAILED';`. The current revision pointer is retained, so the running worker picks it up. Repeating DELETE remains idempotent. Asset objects use `assets/<sessionId>/<assetId>` keys; recording segments use a separate `recordings/<sessionId>/...` prefix. The historical hashed-directory cleanup description no longer applies after ObjectStorage migration.

Asset deletion errors now propagate and preserve ownership indexes for retries. Recording keys (including reserved pending segments) are copied into the durable CLEANUP payload before cascading metadata deletion. Recording writes and deletion use the same Postgres session lock. The first cleanup removes known objects immediately; a second durable pass removes recreated recording objects after `STORAGE_URL_TTL_SECONDS + 300` seconds, with its own bounded retry budget. Keep job payloads until cleanup/retention requirements are satisfied. Issued S3 capabilities cannot be individually revoked: a PUT started before expiry can finish after the five-minute grace. Inspect that deleted session's recording prefix and requeue its current final cleanup job after such an in-flight transfer finishes (use the same SQL but allow `status IN ('FAILED', 'DONE')`). Avoid lowering URL TTL during a rollout without retaining the previous maximum cleanup window. Shared recording-service concurrent reservation semantics are outside this persistence follow-up.

## Checks

- `bun test apps/server/src/modules/platform` — deterministic tests; external tests report skips unless enabled.
- `bun run check-types`, `bun run --filter server build`, `bun run mock:validate`.
- Start a mock server with `MOCK_REPLAY_SPEED=4`, then `bun run --filter server smoke`. Set SERVER_URL if using another port.
- Set TEST_DATABASE_URL to a disposable local Postgres instance and run the tests for real persistence/auth/job integration. Tests create a uniquely named schema and drop only that schema afterward.
- Set TEST_QDRANT_URL for real vector indexing with deterministic embeddings.
- Set TEST_REAL_CONVERTERS=1 inside the server container for genuine PDF/PPT/PPTX tests. TEST_PDF_CONVERTERS=1 selects PDF only when Poppler is available without LibreOffice.
- Set TEST_PROVIDER=1 plus GEMINI_API_KEY and MERGE_GATEWAY_API_KEY for credentialed embedding/structured-output tests. Load the server environment with Varlock when invoking them directly. These calls incur normal provider usage.

Live-service latency targets are glossary <50 ms, retrieval <300 ms p95, ingest <20 s, ten-minute notes <60 s. Ashwath owns slide-pointer latency. Test two-hour notes separately; deterministic partition tests establish bounded inputs, not model quality or end-to-end service latency. External-service timing must never be inferred from mocked tests.

## Deployment handoff to Ashwath

Use Bun 1.4.4 for server, converter dev image and web builder. The registry manifest was verified; an actual Docker/Coolify build remains required. The server needs Poppler, LibreOffice Impress, fonts, private object storage and the forward migration. Local storage additionally needs a shared persistent volume. Configure Qdrant and Merge/Gemini credentials, explicit mock flags and HTTPS URLs/CORS origins. This change does not deploy to the VPS.
