# Sightline

A gaze-aware classroom workspace for **hard-of-hearing** and **deaf** students. It uses our custom eye
tracker for gaze-directed audio focus and gaze-paused captions. It also has context-locked STEM subtitles
that render spoken formulas, a two-way sign-language interpreter, and automatic lecture notes.

**Start here → [`docs/00-overview.md`](docs/00-overview.md)** for the architecture, who owns what, and links
to every contract and owner brief. Deploying: [`docs/deploy.md`](docs/deploy.md).

| Owner | Brief |
| --- | --- |
| Arunya | [Eye tracker hardware + gaze estimation](docs/owners/arunya.md) |
| Harnoor | [Sign language recognition](docs/owners/harnoor.md) |
| Sahil | [Frontend](docs/owners/sahil.md) |
| Ashwath | [Core: live captions + formulas, STT/TTS, gaze software + look→hear, sign sentences, deploy](docs/owners/ashwath.md) |
| Tushar | [Backend surrounding: sessions, knowledge (RAG), notes, slides, persistence](docs/owners/tushar.md) |

## Quick start (everything mocked, no external services)

Use Bun 1.4.4 (the tested runtime). Bun 1.3.10 on Windows can hang during auth integration; Windows startup guidance is in the platform operations document linked below.

```bash
bun install
cp apps/server/.env.example apps/server/.env   # USE_MOCK_DATA=true
cp apps/web/.env.example apps/web/.env
bun run dev                                    # web :3001 + server :3000
bun run mock:gaze                              # mock eye tracker  ws://localhost:7777
bun run mock:sign                              # mock sign service ws://localhost:7788/ws
bun run mock:speaker                           # mock look-to-hear service ws://127.0.0.1:7799/live
```

Or in one terminal: `bun run dev:demo` (server in mock mode + the three device mocks), then `bun run dev:web`.

**Everything real, one command:** `bun run live` starts the server (all modules real), the web app, the look → hear
engine, the gaze bridge (keyboard-driven until the tracker is wired) and the sign mock, after checking keys, ports
and models. Demo: [docs/demo/demo-script.md](docs/demo/demo-script.md) · diagrams: [docs/demo/architecture.md](docs/demo/architecture.md).

The server prints which modules are mocked. A finished demo lecture is seeded, and any new session replays
a live "Kirchhoff's Laws" lecture over the WebSocket. See [`docs/contracts/mock-mode.md`](docs/contracts/mock-mode.md).

## Layout

```
apps/web            Next.js frontend                      (Sahil)
apps/server         Bun + Elysia API + WebSocket          (Ashwath: modules/live, Tushar: modules/platform)
apps/gaze-bridge    Python local gaze + audio-focus daemon (Ashwath; tracker hardware: Arunya)
apps/sign-service   Python recogniser                     (Harnoor)
apps/speaker-service Python look-to-hear voice extraction (Ashwath) — see its README
packages/contracts  zod schemas, types, JSON Schema, typed clients  ← source of truth for every boundary
packages/mocks      fixtures + mock gaze/sign/speaker servers
packages/live-client browser mic, caption streaming, look-to-hear client (Ashwath)
packages/db         Drizzle schema (better-auth + Sightline tables)
packages/auth, ui, config
docs/               overview, owner briefs, contract references
```

## Scripts

Tushar's implementation, recovery, migration and Docker instructions: [platform operations](docs/implementation/tushar-operations.md).

| Command | What |
| --- | --- |
| `bun run dev` / `dev:web` / `dev:server` | Run apps |
| `bun run mock:gaze` / `mock:sign` / `mock:speaker` | Mock device services |
| `bun run sign:setup` / `sign:dev` / `sign:test` / `sign:verify` / `sign:camera` | Alphabet sign service (Python 3.12 + uv; CPU landmark model and backend decoding); [setup and acceptance](apps/sign-service/README.md) |
| `bun run sign:tunnel` | Expose the running alphabet WebSocket at the static NGROK_DOMAIN; prints its WSS URL |
| `bun run sign:check-compose` | Check all six gloss sequences and served speech against the running mock backend |
| `bun run speaker:setup` / `speaker:dev` / `speaker:test` | Real look-to-hear service (uv + PyTorch, downloads pinned weights once) |
| `bun run gaze:dev` / `gaze:test` | Gaze bridge (fake tracker until the hardware is plugged in) |
| `bun run --filter server test` / `check:pipeline` / `eval:captions` | Server unit tests · keyless end-to-end caption pipeline · LLM golden-set eval (needs key) |
| `bun run mock:validate` | Validate fixtures against contracts |
| `bun run --filter server smoke` | End-to-end contract check against a running server |
| `bun run contracts:json-schema` | Regenerate JSON Schemas for the Python services |
| `bun run infra:up` / `infra:down` | Local Postgres + Qdrant |
| `bun run db:push` / `db:studio` | Drizzle |
| `bun run check-types` | Typecheck all workspaces |
| `bun run docker:up` | Production-like compose (deployed via Coolify) |

## Stack

Bun · Elysia · Next.js 16 · better-auth · Postgres + Drizzle · Mastra · Qdrant · Deepgram · ElevenLabs /
Sarvam · KaTeX · Python (OpenCV / MediaPipe) · Docker + Coolify.

## Android USB camera app

Native Kotlin/Jetpack Compose app in [`apps/mobile`](apps/mobile/README.md). Detects external USB webcams and serves separate MJPEG feeds to browsers on your local network. See its README for APK installation, Android Studio setup, wireless debugging, and hardware troubleshooting.

Build with `bun run mobile:apk`; run checks with `bun run mobile:check`. The Android app runs independently of the web/backend services.

## Eye tracking and ESP-CAM

The web setup includes eye/scene calibration, per-profile saved mappings, a sidebar scene preview, and an ESP-CAM person-following segment. See [camera setup](docs/implementation/scene-camera-calibration.md), [person tracking and deployment](docs/implementation/esp-camera-setup.md), and the [local vision companion](vision/README.md).

The matching ESP32-CAM source, pinned build configuration and host tests are in [firmware/esp32-cam](firmware/esp32-cam/README.md). Downloaded libraries, model weights, toolchains, recordings and build outputs are excluded from Git.
