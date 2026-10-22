# Sightline — Project Overview & Team Contract

> **Problem Statement 04:** Build an accessibility assistant that provides real-time captions or converts
> sign language to text for hearing-impaired students in classrooms.

Sightline is a single-user laptop workspace for **hard-of-hearing** and **deaf** students. It combines our
custom **eye tracker** with live captions, context-aware STEM subtitles, a two-way sign-language interpreter,
and automatic lecture notes. No teacher install, no multi-role logins — the student opens the app and goes.

This file is the **entry point**. It explains the whole system, who owns what, and links to:

| Doc | What it is |
| --- | --- |
| [`owners/arun.md`](owners/arun.md) | Arun — eye tracker hardware, gaze bridge, gaze-directed voice isolation |
| [`owners/harnoor.md`](owners/harnoor.md) | Harnoor — sign language recognition (webcam → gloss tokens) |
| [`owners/sahil.md`](owners/sahil.md) | Sahil — the entire frontend (landing, auth, workspace, notes) |
| [`owners/ashwath.md`](owners/ashwath.md) | Ashwath — backend **Intelligence** module (RAG, caption refinement, formulas, notes, sign sentences) |
| [`owners/tushar.md`](owners/tushar.md) | Tushar — backend **Platform & Realtime** module (sessions, uploads, WS gateway, STT/TTS, persistence) |
| [`contracts/rest-api.md`](contracts/rest-api.md) | HTTP API (frontend ↔ server) |
| [`contracts/realtime-ws.md`](contracts/realtime-ws.md) | Session WebSocket (frontend ↔ server): audio up, captions down |
| [`contracts/gaze-bridge.md`](contracts/gaze-bridge.md) | Local gaze bridge protocol (Arun ↔ frontend) |
| [`contracts/sign-service.md`](contracts/sign-service.md) | Sign service protocol (Harnoor ↔ frontend) |
| [`contracts/intelligence-engine.md`](contracts/intelligence-engine.md) | In-process interface between Tushar's and Ashwath's backend modules |
| [`contracts/mock-mode.md`](contracts/mock-mode.md) | `USE_MOCK_DATA`, fixtures, and the mock services everyone can run today |

**Source of truth for every shape is code:** [`packages/contracts`](../packages/contracts) (zod schemas + TS
types). The markdown docs explain intent; if a doc and a schema disagree, the schema wins and the doc is a bug.

---

## 1. The five modules (what the student experiences)

| # | Module | Problem | What we build | Priority |
| - | --- | --- | --- | --- |
| 1 | **Gaze-Directed Audio Focus** | Hearing aids amplify fans, chatter and teacher equally | Eye tracker picks *who you look at*; that voice is isolated into the earphones, switching as gaze moves | P0 |
| 2 | **Gaze-Paused Visual Sync** | Looking up at the board makes deaf students lose the caption stream | Looking away pauses auto-scroll, drops a bookmark, highlights everything said while away; looking back shows the missed block, then resumes live scroll | P0 |
| 3 | **Context-Locked Smart Subtitles + Formula Rendering** | STT mangles jargon ("kerchief law") and spoken maths | Slides/PDF or typed context feed a RAG glossary; captions are corrected and spoken formulas render as LaTeX blocks inline | P0 |
| 4 | **Two-Way Sign Interpreter** | Captions are one-way; the student can't ask back | Webcam signs → gloss → fluent sentence on screen → spoken aloud via TTS. Also translates a peer signing at the camera | P0 |
| 5 | **Context-Linked Lecture Notes** | No time to take notes while reading captions | On "End Lecture", transcript + formulas + context → structured notes (headings, definitions, formulas, takeaways) | P0 |
| — | Live Slide Auto-Pointer | Student loses place in the deck | Captions are matched to the slide + bullet being explained; preview flips & highlights | P1 |
| — | Board-Gaze Markers in Notes | Exam revision | Note sections where the student looked at the board longest are tagged | P1 |

## 2. User flow → which system handles it

| Phase / step | Frontend (Sahil) | Server (Tushar / Ashwath) | Devices (Arun / Harnoor) |
| --- | --- | --- | --- |
| 1.1 Launch & hardware check | Device check screen (bridge, webcam, mic) | `GET /api/health` | Gaze bridge reports `device.status` |
| 1.2 Gaze calibration | Calibration UI (dots / "look at board") | — | Bridge runs calibration, returns `calibration.result` |
| 1.3a Upload PPT/PDF | Upload + slide preview pane | Tushar: store, render pages, extract text → Ashwath: ingest into Qdrant, build glossary | — |
| 1.3b Type context | Context textarea | Ashwath: ingest text, build glossary | — |
| 1.4 Choose mode | Mode toggle (HoH / Deaf), switchable live | `PATCH /api/sessions/:id` | Bridge `mode.set` enables/disables audio focus |
| 2A Audio focus | Shows current focus target + captions as backup | Captions as below | Arun: gaze → target → isolate voice → earphones |
| 2B Smart captions | Caption stream w/ KaTeX formula blocks | Tushar: mic audio → Deepgram (glossary keyterms) → Ashwath: refine + formulas → WS | — |
| 2B Look up at board | Pause scroll, bookmark, highlight missed lines | Tushar: persist gaze transitions | Bridge emits `gaze.zone` = `BOARD` |
| 2B Look back | Show missed block, resume live scroll | — | Bridge emits `gaze.zone` = `SCREEN` |
| 3 Sign a question | Sign panel with webcam preview, sentence, play audio | Ashwath: gloss → sentence; Tushar: TTS → audio URL | Harnoor: frames → gloss tokens |
| 4 End lecture & notes | Notes view + export | Tushar: orchestrate job; Ashwath: generate notes | — |

## 3. Architecture

```
 STUDENT LAPTOP                                                       VPS (Coolify)
┌──────────────────────────────────────────────────────────┐        ┌──────────────────────────────────────┐
│                                                          │        │ server  (Bun + Elysia)  :3000         │
│  Eye tracker ─USB─► gaze-bridge (Arun, Python) :7777     │        │ ┌──────────────────────────────────┐ │
│  Mic array  ─────►   • gaze → zone / person target       │        │ │ platform/   (Tushar)             │ │
│  Earphones  ◄─────   • isolate focused voice → earbuds   │        │ │  sessions · uploads · slides     │ │
│                         │ ws (gaze.zone, audio.focus…)   │        │ │  WS gateway · Deepgram STT       │ │
│                         ▼                                │  REST  │ │  TTS (ElevenLabs/Sarvam) · notes │ │
│  web (Sahil, Next.js in the browser) ────────────────────┼───────►│ │  job · Postgres persistence      │ │
│   • workspace, captions, slides, notes                   │   WS   │ └───────────────┬──────────────────┘ │
│   • mic PCM ─────────────────────────────────────────────┼───────►│                 │ IntelligenceEngine │
│   • forwards gaze transitions ───────────────────────────┼───────►│ ┌───────────────▼──────────────────┐ │
│   • webcam frames ─┐                                     │        │ │ intelligence/  (Ashwath)         │ │
│                    ▼                                     │        │ │  Mastra agents · Qdrant RAG      │ │
│  sign-service (Harnoor, Python) :7788  ◄── frames        │        │ │  caption refiner · formulas      │ │
│     returns sign.token (gloss) ──► web                   │        │ │  sign sentence · notes · slides  │ │
│  (may also be deployed on the VPS — URL is config)       │        │ └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘        │  Postgres · Qdrant (self-hosted)     │
                                                                    └──────────────────────────────────────┘
```

Key decisions:

1. **The gaze bridge runs locally** next to the hardware and talks straight to the browser
   (`ws://localhost:7777`). Caption pausing must react in < 100 ms; a VPS round-trip is not needed for that.
   The browser forwards *transitions* (not raw samples) to the server only for persistence/notes.
2. **Voice isolation is fully local** (Arun's bridge → earphones). The server never touches that audio.
   Captions are transcribed from the browser mic. (Stretch: bridge can expose the isolated stream for STT.)
3. **Sign recognition is its own service** so Harnoor can use Python/MediaPipe freely. It returns *gloss
   tokens only*; turning gloss into a fluent sentence is Ashwath's LLM job, speaking it is Tushar's TTS job.
4. **The backend is one deployable** (`apps/server`) split into two modules with an in-process interface
   (`IntelligenceEngine`). Tushar's code only ever calls Ashwath's module through that interface, so a mock
   implementation can be swapped in with one env flag.
5. **Shared contracts package** (`@sightline/contracts`) holds every schema/type used across a boundary. Sahil,
   Tushar and Ashwath import it directly; Arun and Harnoor get generated JSON Schemas
   (`packages/contracts/json-schema/`) for their Python code.

## 4. Ownership matrix

| Area | Owner | Lives in | Depends on | Unblocked today by |
| --- | --- | --- | --- | --- |
| Eye tracker hardware + firmware | **Arun** | (hardware) | — | — |
| Gaze bridge (zones, targets, calibration) | **Arun** | `apps/gaze-bridge` | contracts | — |
| Gaze-directed voice isolation | **Arun** | `apps/gaze-bridge` | — | — |
| Sign recognition (frames → gloss tokens) | **Harnoor** | `apps/sign-service` | contracts | — |
| Landing, auth screens, dashboard | **Sahil** | `apps/web` | REST API | server in mock mode |
| Session setup, upload, mode toggle | **Sahil** | `apps/web` | REST API | server in mock mode |
| Live workspace: captions, formulas, gaze-pause, slides | **Sahil** | `apps/web` | WS, gaze bridge | mock server + `bun run mock:gaze` |
| Sign panel | **Sahil** | `apps/web` | sign service, REST | `bun run mock:sign` |
| Notes view & export | **Sahil** | `apps/web` | REST API | server in mock mode |
| Context ingestion (RAG / Qdrant), glossary | **Ashwath** | `apps/server/src/modules/intelligence` | — | fixtures |
| Caption refinement + formula → LaTeX | **Ashwath** | same | — | fixtures |
| Sign gloss → fluent sentence | **Ashwath** | same | — | fixtures |
| Notes generation, slide pointer (P1), board markers (P1) | **Ashwath** | same | — | fixtures |
| Sessions, auth guard, DB schema, persistence | **Tushar** | `apps/server/src/modules/platform` + `packages/db` | — | in-memory store |
| Uploads, PDF/PPT → slide images + text | **Tushar** | same | — | mock slides |
| Realtime WS gateway, Deepgram streaming STT | **Tushar** | same | `IntelligenceEngine` | `MOCK_INTELLIGENCE=true` |
| TTS (ElevenLabs / Sarvam), audio serving | **Tushar** | same | — | mock TTS |
| Notes job orchestration, notes export | **Tushar** | same | `IntelligenceEngine` | `MOCK_INTELLIGENCE=true` |
| `@sightline/contracts` | **Everyone (PR-reviewed)** | `packages/contracts` | — | — |
| Deploy (Coolify), env, infra | **Tushar** (Ashwath backup) | `docker-compose*.yml` | — | — |

### Who relies on whom

```
Sahil  ──REST/WS──►  Tushar  ──IntelligenceEngine──►  Ashwath
  │                    ▲
  ├─ws─►  Arun (gaze bridge)          Ashwath relies on nobody at runtime; he receives inputs through
  └─ws─►  Harnoor (sign service)      the interface and returns outputs. Tushar relies on Ashwath only
                                      through that interface (mockable). Sahil relies on Tushar's API
                                      (mockable) and on Arun/Harnoor's local sockets (mockable).
```

## 5. Mock mode (how everyone starts on day one)

`apps/server/.env` has a master switch **`USE_MOCK_DATA=true`** plus optional per-module overrides:

| Flag | When `true` |
| --- | --- |
| `USE_MOCK_DATA` | Default for every flag below |
| `MOCK_INTELLIGENCE` | Ashwath's module is replaced by fixture-driven `MockIntelligenceEngine` |
| `MOCK_SPEECH` | STT replays a scripted lecture (no mic, no Deepgram); TTS returns a generated tone |
| `MOCK_PERSISTENCE` | In-memory store instead of Postgres (no DB needed); seeds a finished demo lecture |
| `MOCK_SLIDES` | Any upload becomes the fixture deck rendered as SVG slides |
| `MOCK_AUTH` | `/api/*` acts as a fixed demo user (better-auth still mounted for Sahil's auth screens) |

Typical setups:

- **Sahil:** `USE_MOCK_DATA=true` → full API + live caption stream with zero services. Run
  `bun run mock:gaze` and `bun run mock:sign` for the device sockets.
- **Tushar:** `USE_MOCK_DATA=false`, `MOCK_INTELLIGENCE=true` → real Postgres + Deepgram, fake intelligence.
- **Ashwath:** `USE_MOCK_DATA=true`, `MOCK_INTELLIGENCE=false` → real Mastra/Qdrant fed by the mock lecture
  replay; or test the engine directly via the dev routes (`/api/dev/intelligence/*`).
- **Arun / Harnoor:** run their Python service and point the web app (or the protocol test client) at it.

Details, fixture list and the mock device servers: [`contracts/mock-mode.md`](contracts/mock-mode.md).

## 6. Repository layout

```
sightline/
├── apps/
│   ├── web/                  Sahil   — Next.js frontend
│   ├── server/               Tushar + Ashwath — Bun/Elysia API + WS
│   │   └── src/
│   │       ├── modules/platform/      Tushar
│   │       ├── modules/intelligence/  Ashwath
│   │       └── container.ts           picks real vs mock implementations from the MOCK_* flags
│   ├── gaze-bridge/          Arun    — Python, local daemon (skeleton speaks the protocol)
│   └── sign-service/         Harnoor — Python service (skeleton speaks the protocol)
├── packages/
│   ├── contracts/            Everyone — zod schemas, TS types, JSON Schema export, typed clients
│   ├── mocks/                Fixtures (Kirchhoff lecture) + mock gaze/sign servers
│   ├── db/ auth/ ui/ config/ (scaffold)
└── docs/                     This file, owner briefs, contract docs
```

## 7. Conventions (applies to everyone)

- **Naming:** JSON fields `camelCase`; enum values `UPPER_SNAKE`; REST paths plural nouns; WS/socket message
  `type`s are `domain.event` (e.g. `caption.refined`, `gaze.zone`).
- **Timestamps:** every realtime message carries `ts` = Unix epoch **milliseconds**. Caption segments also
  carry `startMs`/`endMs` = offset from the session's `startedAt`.
- **IDs:** prefixed strings — `ses_…`, `seg_…`, `sld_…`, `utt_…`, `nts_…`, `tok_…`.
- **Errors (REST):** always `{ "error": { "code": "UPPER_SNAKE", "message": "...", "details"?: any } }`.
  Codes: `VALIDATION_ERROR` 422, `UNAUTHORIZED` 401, `NOT_FOUND` 404, `CONFLICT` 409,
  `NOT_IMPLEMENTED` 501, `UPSTREAM_ERROR` 502, `INTERNAL` 500.
- **Errors (sockets):** `{ "type": "error", "code": "...", "message": "...", "ts": 0 }`.
- **Changing a contract:** additive changes only (new optional fields / new message types). Anything breaking
  → ping the team, update `packages/contracts`, the doc, the fixtures and the mocks in the same PR.
- **Git:** short-lived branches `<name>/<topic>` (e.g. `sahil/caption-stream`), small commits with
  conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`), rebase on `main` often.

## 8. Integration checkpoints

| # | Checkpoint | Proves |
| - | --- | --- |
| M0 | Everyone runs against mocks | Contracts are complete enough to build on |
| M1 | Real gaze bridge → web pauses/resumes captions (mock server) | Arun ↔ Sahil |
| M2 | Real sign-service → web → mock compose → tone | Harnoor ↔ Sahil |
| M3 | Real Deepgram + mock intelligence → web captions | Tushar ↔ Sahil |
| M4 | Real intelligence refines captions + formulas, notes generated | Ashwath ↔ Tushar |
| M5 | Full demo run (Kirchhoff lecture) with hardware, flags all `false` | Demo ready |

## 9. Tech stack

Bun · Elysia · Next.js 16 · better-auth · Postgres + Drizzle · Mastra · Qdrant (self-hosted) · Deepgram
(streaming STT, keyterm prompting) · ElevenLabs / Sarvam (TTS) · KaTeX (formula rendering) · Python
(gaze bridge, sign service: OpenCV / MediaPipe) · Docker → Coolify on our VPS.
