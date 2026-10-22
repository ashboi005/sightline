# Running Tushar's platform

## Mock development

Install with `bun install`, copy `apps/server/.env.example` to `apps/server/.env`, and run `bun run dev:server`. All mock flags inherit `USE_MOCK_DATA=true`. No AI key, Qdrant or Postgres connection is used by the mocked platform. The better-auth signup screens still require a database, as before.

Use the pinned Bun 1.4.4 runtime. Real Postgres/auth/WebSocket integration passes with 1.4.4; Bun 1.3.10 on this Windows host hangs during the revoked-cookie test. You can invoke the tested runtime temporarily with `bun x --package bun@1.4.4 bun ...` without changing the global installation.

On Windows, Varlock 1.18.0's executable shim can terminate with `UV_HANDLE_CLOSING`. The verified server-start workaround from `apps/server` is `node ../../node_modules/varlock/bin/cli.js run -- bun src/index.ts`. On this host, code generation writes its output successfully but the helper may still exit abnormally; inspect its diagnostics and run type checks. The Docker path avoids this Windows-specific helper problem. Public server/auth URLs and allowed origins are intentionally marked public in the schema, while secrets remain sensitive.

## Docker-first real platform

`docker compose -f docker-compose.platform.yml up --build` starts Postgres, Qdrant and the server with real persistence and converters, while retaining mock speech/captions/knowledge/notes. The development image applies versioned migrations before startup. It includes Poppler, LibreOffice and fonts. Source files and rendered assets persist on the uploads volume.

To enable actual AI engines, set `MOCK_KNOWLEDGE=false`, `MOCK_NOTES=false`, and `OPENAI_API_KEY` in `apps/server/.env`. Keep `MOCK_SPEECH=true` and `MOCK_CAPTIONS=true` to exercise the platform with the replay lecture independently of Ashwath's pending providers. Model defaults are `openai/gpt-4.1-mini` and `openai/text-embedding-3-small`. To test real login, set `MOCK_AUTH=false` and register a user. Never deploy the development secret or mock auth configuration publicly.

When running Bun outside Docker, `bun run infra:up` supplies the database and Qdrant. Run `bun run db:migrate` with DATABASE_URL configured, then start the server. Real conversion additionally requires `pdfinfo`, `pdftoppm`, `pdftotext`, and `libreoffice` on PATH; Docker is the supported converter runtime.

## Migrations and upgrades

The initial versioned migration creates both better-auth and lecture tables. It is intentionally idempotent for the previously documented `db:push` scaffold: table/index creation and foreign-key installation tolerate existing definitions, and the new notes_error column is explicitly added when absent. Back up existing data, stop the server, configure the same DATABASE_URL, and run `bun run db:migrate`. Do not delete existing tables or volumes and do not re-run `db:push` as a deployment step. This upgrade assumes the earlier scaffold's column definitions; inspect custom schema divergence before applying it. Subsequent schema changes use `bun run db:generate` and reviewed forward migrations.

## Recovery and cleanup

Jobs are claimed with renewable leases and serialize within a lecture. Transient failures retry three times; converter/empty-input validation failures are terminal. Poll the existing slides/context/notes routes for results. Failed notes include an error and retain the last successful notes. Retry notes through the existing regenerate endpoint, slides by uploading again, and context by setting text again.

Session deletion cancels existing work, removes database lecture rows, and queues external cleanup. Cleanup jobs deliberately do not have a cascading session foreign key. If Qdrant is down, cleanup retries rather than silently succeeding. Check server job logs and platform_job rows for terminal failures. STORAGE_DIR and database backups must be preserved together. A single application deployment should own its filesystem volume.

After fixing an outage, an operator can requeue a specific terminal cleanup job with `UPDATE platform_job SET status = 'PENDING', attempts = 0, token = NULL, lease_until = NULL, available_at = (extract(epoch from clock_timestamp()) * 1000)::bigint WHERE id = '<failed cleanup job ID>' AND kind = 'CLEANUP' AND status = 'FAILED';`. The current revision pointer is retained, so the running worker picks it up. Repeating DELETE remains idempotent. Asset files live in hashed per-session directories; deleting that directory also removes staged files left by an interrupted metadata transaction.

## Checks

- `bun test apps/server/src/modules/platform` — deterministic tests; external tests report skips unless enabled.
- `bun run check-types`, `bun run --filter server build`, `bun run mock:validate`.
- Start a mock server with `MOCK_REPLAY_SPEED=4`, then `bun run --filter server smoke`. Set SERVER_URL if using another port.
- Set TEST_DATABASE_URL to a disposable local Postgres instance and run the tests for real persistence/auth/job integration. Tests create a uniquely named schema and drop only that schema afterward.
- Set TEST_QDRANT_URL for real vector indexing with deterministic embeddings.
- Set TEST_REAL_CONVERTERS=1 inside the server container for genuine PDF/PPT/PPTX tests. TEST_PDF_CONVERTERS=1 selects PDF only when Poppler is available without LibreOffice.
- Set TEST_PROVIDER=1 plus OPENAI_API_KEY for credentialed embedding/structured-output tests. These calls incur normal provider usage.

Live-service latency targets are glossary <50 ms, retrieval <300 ms p95, pointer <500 ms, ingest <20 s, ten-minute notes <60 s. Test two-hour notes separately; deterministic partition tests establish bounded inputs, not model quality or end-to-end service latency. External-service tests and timing results must never be inferred from mocked tests.

## Deployment handoff to Ashwath

The server runtime now needs Poppler, LibreOffice Impress, fonts, a persistent STORAGE_DIR volume and the new database migration. All application instances must access the same asset volume. Point QDRANT_URL/QDRANT_API_KEY at the provided service, configure AI credentials and real mock flags explicitly, and use HTTPS URLs/CORS origins for cross-site cookies. This change does not deploy to the VPS.
