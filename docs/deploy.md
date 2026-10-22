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
   After the first deploy, run `bun run db:push` once against it (from your machine with the public URL, or a
   Coolify one-off command).
2. **Qdrant:** create the service with a persistent volume on `/qdrant/storage` and set `QDRANT__SERVICE__API_KEY`.
   Server env: `QDRANT_URL=http://<internal-host>:6333`, `QDRANT_API_KEY=…`.

## 2. Server app

- Build: Dockerfile `apps/server/Dockerfile`, build context = repo root. Port 3000, health check `GET /api/health`.
- Domain: `https://api.<domain>`. WebSockets must be allowed through the proxy (Coolify/Traefik does this by default).
- Volume: mount persistent storage at `STORAGE_DIR` (e.g. `/data/uploads`, and set `STORAGE_DIR=/data/uploads`).
- Environment: everything in [`apps/server/.env.example`](../apps/server/.env.example). Production values:

| Var | Value |
| --- | --- |
| `NODE_ENV` | `production` (also disables `/api/dev/*`) |
| `PUBLIC_SERVER_URL`, `BETTER_AUTH_URL` | `https://api.<domain>` |
| `CORS_ORIGIN` | `https://<domain>` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `DATABASE_URL` | Postgres internal URL |
| `USE_MOCK_DATA` | `false`, then force still-unfinished modules back on (e.g. `MOCK_KNOWLEDGE=true`, `MOCK_NOTES=true`, `MOCK_SLIDES=true`, `MOCK_PERSISTENCE=true` until Tushar's are ready) |
| `DEEPGRAM_API_KEY` | required when `MOCK_SPEECH=false` |
| `TTS_PROVIDER` + `ELEVENLABS_API_KEY` or `SARVAM_API_KEY` | required when `MOCK_SPEECH=false` |
| `OPENAI_API_KEY` (or the provider of `CAPTION_MODEL`/`SIGN_MODEL`) | required when `MOCK_CAPTIONS=false` |
| `QDRANT_URL`, `QDRANT_API_KEY`, `EMBEDDING_MODEL`, `LLM_MODEL` | Tushar's modules |

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
```
