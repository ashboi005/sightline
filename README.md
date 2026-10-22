# Sightline

A gaze-aware classroom workspace for **hard-of-hearing** and **deaf** students. It uses our custom eye
tracker for gaze-directed audio focus and gaze-paused captions. It also has context-locked STEM subtitles
that render spoken formulas, a two-way sign-language interpreter, and automatic lecture notes.

**Start here → [`docs/00-overview.md`](docs/00-overview.md)** for the architecture, who owns what, and links
to every contract and owner brief.

| Owner | Brief |
| --- | --- |
| Arunya | [Eye tracker hardware + gaze estimation](docs/owners/arunya.md) |
| Harnoor | [Sign language recognition](docs/owners/harnoor.md) |
| Sahil | [Frontend](docs/owners/sahil.md) |
| Ashwath | [Core: live captions + formulas, STT/TTS, gaze software + look→hear, sign sentences, deploy](docs/owners/ashwath.md) |
| Tushar | [Backend surrounding: sessions, knowledge (RAG), notes, slides, persistence](docs/owners/tushar.md) |

## Quick start (everything mocked, no external services)

```bash
bun install
cp apps/server/.env.example apps/server/.env   # USE_MOCK_DATA=true
cp apps/web/.env.example apps/web/.env
bun run dev                                    # web :3001 + server :3000
bun run mock:gaze                              # mock eye tracker  ws://localhost:7777
bun run mock:sign                              # mock sign service ws://localhost:7788/ws
```

The server prints which modules are mocked. A finished demo lecture is seeded, and any new session replays
a live "Kirchhoff's Laws" lecture over the WebSocket. See [`docs/contracts/mock-mode.md`](docs/contracts/mock-mode.md).

## Layout

```
apps/web            Next.js frontend                      (Sahil)
apps/server         Bun + Elysia API + WebSocket          (Ashwath: modules/live, Tushar: modules/platform)
apps/gaze-bridge    Python local gaze + audio-focus daemon (Ashwath; tracker hardware: Arunya)
apps/sign-service   Python recogniser                     (Harnoor)
packages/contracts  zod schemas, types, JSON Schema, typed clients  ← source of truth for every boundary
packages/mocks      fixtures + mock gaze/sign servers
packages/db         Drizzle schema (better-auth + Sightline tables)
packages/auth, ui, config
docs/               overview, owner briefs, contract references
```

## Scripts

| Command | What |
| --- | --- |
| `bun run dev` / `dev:web` / `dev:server` | Run apps |
| `bun run mock:gaze` / `mock:sign` | Mock device services |
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
