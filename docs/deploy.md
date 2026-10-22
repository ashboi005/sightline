# Deploying Sightline (Coolify on our VPS)

> Owner: **Ashwath**. Once the VPS Qdrant is up, hand its URL + API key to Tushar (only `QDRANT_URL` / `QDRANT_API_KEY`
> change on his side).

## What runs where

| Piece | Where | How |
| --- | --- | --- |
| `server` (Bun + Elysia, REST + session WebSocket) | VPS | Coolify app, `apps/server/Dockerfile`, port 3000 |
| `web` (Next.js) | VPS | Coolify app, `apps/web/Dockerfile`, port 3001 |
| Postgres | VPS | Coolify service (Postgres 17) |
| Qdrant | VPS | Coolify service (`qdrant/qdrant:v1.15.4`), API key on |
| gaze bridge, speaker service, (sign service) | **Student laptop** | run locally: they talk to hardware/the mic and must be loopback |

## 1. Databases

1. **Postgres:** create the service, then copy the *internal* connection URL → server `DATABASE_URL`.
   Before starting the upgraded server, back up the database and run `bun run db:migrate` against it (from your
   machine with the public URL, or a Coolify one-off command). Include the snapshot/recording forward migration;
   do not use `db:push` for deployment. See [platform upgrades](implementation/tushar-operations.md#migrations-and-upgrades).
2. **Qdrant:** create the service with a persistent volume on `/qdrant/storage` and set `QDRANT__SERVICE__API_KEY`.
   Server env: `QDRANT_URL=http://<internal-host>:6333`, `QDRANT_API_KEY=…`. Prefer the *internal* URL: over the public
   `http://…sslip.io` proxy the API key travels in clear text. A URL without a port now means 80/443 (the Qdrant JS
   client would otherwise silently add `:6333` — handled in `container.ts`).
3. **S3:** `S3_ACCESS_KEY_ID` is marked `@public` in `.env.schema` on purpose — AWS puts it in every presigned URL
   (`X-Amz-Credential`) and varlock's leak scanner would otherwise 500 any response carrying one. The secret stays
   sensitive. Use an IAM user scoped to the one bucket.

## 2. Server app

- Build: Dockerfile `apps/server/Dockerfile`, build context = repo root. Port 3000, health check `GET /api/health`.
- Domain: `https://api.<domain>`. WebSockets must be allowed through the proxy (Coolify/Traefik does this by default).
- Storage: set `STORAGE_DRIVER=s3` with `S3_BUCKET`, `S3_REGION` (`auto` for R2), `S3_ENDPOINT` (R2/MinIO only),
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. With `STORAGE_DRIVER=local` instead, mount a volume at `STORAGE_DIR`.
- **Bucket CORS** (browsers PUT recordings and GET media straight from the bucket):

  ```json
  [{ "AllowedOrigins": ["https://<domain>"], "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["content-type", "range"], "ExposeHeaders": ["etag", "content-range", "accept-ranges"], "MaxAgeSeconds": 3600 }]
  ```
- Keep the bucket **private**: every read and write goes through short-lived presigned URLs.
- Environment: everything in [`apps/server/.env.example`](../apps/server/.env.example). Production values:

| Var | Value |
| --- | --- |
| `NODE_ENV` | `production` (also disables `/api/dev/*`) |
| `PUBLIC_SERVER_URL`, `BETTER_AUTH_URL` | `https://api.<domain>` |
| `CORS_ORIGIN` | `https://<domain>` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_COOKIE_DOMAIN` | the parent domain, e.g. `sightline.app` (web on `sightline.app`, API on `api.sightline.app`). **Required**: without it the session cookie stays on the API host and the web app's server-rendered pages (dashboard) never see it |
| `DATABASE_URL` | Postgres internal URL |
| `USE_MOCK_DATA` | `false` for real engines; explicitly retain mocks for integrations not yet accepted. Platform implementations exist; real-service acceptance is separate. Never deploy mock auth publicly. |
| `DEEPGRAM_API_KEY` | required when `MOCK_SPEECH=false` and `STT_PROVIDER=deepgram` |
| `TTS_PROVIDER` + `ELEVENLABS_API_KEY` or `SARVAM_API_KEY` | required when `MOCK_SPEECH=false` |
| `MERGE_GATEWAY_API_KEY` (+ `CAPTION_MODEL`, `SIGN_MODEL`, `VISION_MODEL`) | required when `MOCK_CAPTIONS=false` (all LLM + vision calls go through Merge Gateway) |
| `STT_PROVIDER` | `elevenlabs` (default, Scribe v2 realtime; Hinglish via `hi` + English), `deepgram`, or `sarvam` (`SARVAM_STT_MODE=codemix`) |
| `QDRANT_URL`, `QDRANT_API_KEY`, `EMBEDDING_MODEL`, `LLM_MODEL` | Tushar's modules |
| `GEMINI_API_KEY` … `GEMINI_API_KEY_4` | Embeddings (+ any `gemini/…` model); one key per Google Cloud project, rotated per call |
| `CAPTION_MODEL`, `SIGN_MODEL`, `VISION_MODEL`, `LLM_MODEL`, `LLM_HEDGE_MS` | Comma-separated model lists (hedged for captions/sign, fallback otherwise) — defaults in `.env.schema` |

## 3. Web app

- Build: Dockerfile `apps/web/Dockerfile`, context = repo root, port 3001, domain `https://<domain>`.
- **Build args** (Next.js inlines them at build time):
  - `NEXT_PUBLIC_SERVER_URL=https://api.<domain>`
  - `NEXT_PUBLIC_SERVER_WS_URL=wss://api.<domain>`
  - the laptop-local URLs keep their defaults (`ws://localhost:7777`, `ws://localhost:7788`, `ws://127.0.0.1:7799/live`).
- Cookies: better-auth uses `SameSite=None; Secure`. Both apps must be served over HTTPS.

## 4. Student laptop (demo machine)

```bash
bun run gaze:dev          # gaze bridge  ws://localhost:7777   (real tracker: --tracker <name>)
bun run speaker:setup     # once: Python deps + pinned model weights (~280 MB)
bun run speaker:dev --origin https://<domain>   # look-to-hear; origin must be the deployed web origin
```

Browsers allow `ws://localhost` from an HTTPS page, so the deployed web app can reach these local services.

## 5. Verify

```bash
curl https://api.<domain>/api/health          # mocks flags show what is real
SERVER_URL=https://api.<domain> bun run --filter server smoke   # only with MOCK_SPEECH=true (replay)
SERVER_URL=https://api.<domain> WEB_ORIGIN=https://<domain> bun run --filter server check:auth
SERVER_URL=https://api.<domain> WEB_ORIGIN=https://<domain> bun run --filter server check:e2e   # everything real
```

`check:e2e` signs up a throwaway `e2e+<ts>@sightline.dev` user, speaks the Kirchhoff lecture with ElevenLabs TTS into
the session socket, and walks context → slides → captions → sign → snapshot → recording → notes → delete against
real Postgres, S3, Qdrant, Merge GLM, Gemini and ElevenLabs. It deletes its session (S3 + Qdrant included); the test
user stays. Last local run (2026-10-22): all checks pass — context 20–70 s, slides 20 s, first caption ~5.8 s after
audio start, sign sentence 5 s, notes 40 s.
