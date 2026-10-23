# Sightline — Project Overview & Team Contract

> **Problem Statement 04:** Build an accessibility assistant that provides real-time captions or converts
> sign language to text for hearing-impaired students in classrooms.

Sightline is a single-user laptop workspace for **hard-of-hearing** and **deaf** students. It combines our
custom **eye tracker** with live captions, context-aware STEM subtitles, a two-way sign-language interpreter,
and automatic lecture notes. No teacher install, no multi-role logins — the student opens the app and goes.

This file is the **entry point**. It explains the whole system, who owns what, and links to:

| Doc | What it is |
| --- | --- |
| [`owners/arunya.md`](owners/arunya.md) | Arunya — eye tracker hardware + gaze estimation |
| [`owners/harnoor.md`](owners/harnoor.md) | Harnoor — sign language recognition (webcam → gloss tokens) |
| [`owners/sahil.md`](owners/sahil.md) | Sahil — the entire frontend (landing, auth, workspace, notes) |
| [`owners/ashwath.md`](owners/ashwath.md) | Ashwath — **core**: live pipeline (STT, captions, formulas, WS), gaze software + look→hear, sign sentences + TTS, deploy |
| [`owners/tushar.md`](owners/tushar.md) | Tushar — **surrounding**: sessions + persistence, slides, knowledge (RAG/Qdrant), post-lecture notes, auth |
| [`contracts/frontend-api.md`](contracts/frontend-api.md) | **Every API the web app uses** (REST, auth, session socket, S3 media, laptop services) with schema links |
| [`contracts/rest-api.md`](contracts/rest-api.md) | REST request/response examples |
| [`contracts/realtime-ws.md`](contracts/realtime-ws.md) | Session WebSocket (frontend ↔ server): audio up, captions down |
| [`contracts/gaze-bridge.md`](contracts/gaze-bridge.md) | Local gaze bridge protocol (eye tracker → zones + scene gaze ↔ frontend) |
| [`contracts/speaker-service.md`](contracts/speaker-service.md) | Local look-to-hear speaker service (scene frames + room mic → the looked-at person's voice) |
| [`contracts/sign-service.md`](contracts/sign-service.md) | Sign service protocol (Harnoor ↔ frontend) |
| [`contracts/backend-modules.md`](contracts/backend-modules.md) | In-process interfaces between Ashwath's core and Tushar's surrounding modules |
| [`contracts/mock-mode.md`](contracts/mock-mode.md) | `USE_MOCK_DATA`, fixtures, and the mock services everyone can run today |
| [`contracts/recordings.md`](contracts/recordings.md) | Session recordings: browser recorder → presigned uploads to S3 → playback |
| [`implementation/sign-service-plan.md`](implementation/sign-service-plan.md) | Harnoor completion plan, audit, measured runtime evidence and open two-signer/M2 acceptance |
| [`deploy.md`](deploy.md) | Coolify deployment: server, web, Postgres, Qdrant; what runs on the student laptop |

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
| — | Live Slide Auto-Pointer | Student loses place in the deck | Captions are matched to the slide + bullet being explained; preview flips & highlights (✅ built, Ashwath) | P1 |
| — | Smart Board Snapshots | Diagrams drawn on the board never make it into notes | When the teacher says "look at this diagram", the student keeps looking at the board, or the board changes and settles, the scene frame is captured, described by a vision model and placed in the right notes section (✅ built, Ashwath; pointing-gesture trigger is next) | P1 |
| — | Hinglish | Indian classrooms mix Hindi and English | Sarvam streaming STT in code-mix mode keeps Hindi + English as spoken; sign replies can be spoken in Hinglish (✅ built, Ashwath) | P0 |
| — | Board-Gaze Markers in Notes | Exam revision | Note sections where the student looked at the board longest are tagged | P1 |

## 2. User flow → which system handles it

| Phase / step | Frontend (Sahil) | Server (Ashwath / Tushar) | Devices (gaze: Arunya hw + Ashwath sw / sign: Harnoor) |
| --- | --- | --- | --- |
| 1.1 Launch & hardware check | Device check screen (bridge, webcam, mic) | `GET /api/health` | Gaze bridge reports `device.status` |
| 1.2 Gaze calibration | Calibration UI (dots / "look at board") | — | Bridge runs calibration, returns `calibration.result` |
| 1.3a Upload PPT/PDF | Upload + slide preview pane | Tushar: store, render pages, extract text, ingest into Qdrant, build glossary | — |
| 1.3b Type context | Context textarea | Tushar: ingest text, build glossary | — |
| 1.4 Choose mode | Mode toggle (HoH / Deaf), switchable live | `PATCH /api/sessions/:id` | Bridge `mode.set` enables/disables audio focus |
| 2A Audio focus | Shows current focus target + captions as backup | Captions as below | Tracker (Arunya) → bridge (Ashwath): gaze → target → isolate voice → earphones |
| 2B Smart captions | Caption stream w/ KaTeX formula blocks | Ashwath: mic audio → Deepgram (keyterms from Tushar's glossary) → refine + formulas → WS | — |
| 2B Look up at board | Pause scroll, bookmark, highlight missed lines | Ashwath: socket stores gaze transitions (Tushar's store) | Bridge emits `gaze.zone` = `BOARD` |
| 2B Look back | Show missed block, resume live scroll | — | Bridge emits `gaze.zone` = `SCREEN` |
| 3 Sign a question | Sign panel with webcam preview, sentence, play audio | Ashwath: gloss → sentence → TTS → audio URL | Harnoor: frames → gloss tokens |
| 4 End lecture & notes | Notes view + export | Tushar: notes job + NotesEngine (RAG-grounded) | — |

## 3. Architecture

```
 STUDENT LAPTOP                                                       VPS (Coolify)
┌──────────────────────────────────────────────────────────┐        ┌──────────────────────────────────────┐
│                                                          │        │ server  (Bun + Elysia)  :3000         │
│  Eye tracker ─USB─► gaze-bridge (Python) :7777           │        │ ┌──────────────────────────────────┐ │
│  (Arunya hw) │       • gaze → zone / person target       │        │ │ live/   (Ashwath — core)         │ │
│  scene cam + mic ─► speaker-service (Python) :7799       │        │ │  WS gateway · Deepgram STT       │ │
│  Earphones ◄── focused voice of the face you look at     │        │ │  CaptionEngine (Mastra):         │ │
│                         │ ws (gaze.zone, audio.focus…)   │        │ │   jargon fix · formulas → LaTeX  │ │
│                         ▼                                │  REST  │ │  sign sentence · TTS             │ │
│  web (Sahil, Next.js in the browser) ────────────────────┼───────►│ └──────┬─────────────────▲─────────┘ │
│   • workspace, captions, slides, notes                   │   WS   │  KnowledgeEngine │  Lifecycle/Events │
│   • mic PCM ─────────────────────────────────────────────┼───────►│  SessionStore    │                   │
│   • forwards gaze transitions ───────────────────────────┼───────►│ ┌──────▼─────────────────┴─────────┐ │
│   • webcam frames ─┐                                     │        │ │ platform/  (Tushar — surrounding)│ │
│                    ▼                                     │        │ │  sessions · auth · slides        │ │
│  sign-service (Harnoor, Python) :7788  ◄── frames        │        │ │  KnowledgeEngine (Qdrant RAG)    │ │
│     returns sign.token (gloss) ──► web                   │        │ │  NotesEngine · Postgres store    │ │
│  (may also be deployed on the VPS — URL is config)       │        │ └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘        │  Postgres · Qdrant (self-hosted)     │
                                                                    └──────────────────────────────────────┘
```

Key decisions:

1. **The gaze bridge runs locally** next to the hardware and talks straight to the browser
   (`ws://localhost:7777`). Caption pausing must react in < 100 ms; a VPS round-trip is not needed for that.
   The browser forwards *transitions* (not raw samples) to the server only for persistence/notes.
2. **Look → hear is fully local.** Calibrated scene gaze supplies the point. In Focus a person, the student
   confirms a detected face with voice or a button, or clicks it, and tells the local **speaker service** (`:7799`).
   That service extracts the face's voice from the room mic with AV-MossFormer2 by default, and the browser
   plays it into the selected speaker. AV needs three seconds of aligned input plus inference/playback delay.
   The server never touches that audio. Hardware + gaze estimation: Arunya. Bridge + speaker service: Ashwath.
   Captions are transcribed from the browser mic. (Stretch: bridge can expose the isolated stream for STT.)
3. **Sign recognition is its own service** so Harnoor can use Python/MediaPipe freely. It returns *gloss
   tokens only*; turning gloss into a fluent sentence and speaking it are both Ashwath's (core) job.
4. **The backend is one deployable** (`apps/server`) split into two modules. `live/` (Ashwath, the core) and
   `platform/` (Tushar, the surrounding) only see each other through interfaces (`CaptionEngine`,
   `KnowledgeEngine`, `NotesEngine`, `SessionStore`, `SessionLifecycle`, `SessionEvents`), each with a mock that
   one env flag swaps in. See [contracts/backend-modules.md](contracts/backend-modules.md).
5. **Shared contracts package** (`@sightline/contracts`) holds every schema/type used across a boundary. Sahil,
   Tushar and Ashwath import it directly; the Python services get generated JSON Schemas
   (`packages/contracts/json-schema/`) for their Python code.

## 4. Ownership matrix

| Area | Owner | Lives in | Depends on | Unblocked today by |
| --- | --- | --- | --- | --- |
| Eye tracker hardware, firmware, gaze estimation | **Arunya** | (hardware) | — | — |
| Gaze bridge software (zones, targets, calibration flow) | **Ashwath** | `apps/gaze-bridge` | tracker output | fake tracker in the bridge |
| Gaze-directed voice isolation (look → hear) | **Ashwath** | `apps/speaker-service` + `createGazeTargetSelector` | scene gaze (`gaze.scene`) | `bun run mock:speaker` |
| Sign recognition (frames → gloss tokens) | **Harnoor** | `apps/sign-service` | contracts | — |
| Landing, auth screens, dashboard, setup, workspace, sign panel, notes UI | **Sahil** | `apps/web` | REST, WS, local sockets | mock server + `bun run mock:gaze` / `mock:sign` |
| Live WS gateway, Deepgram STT, caption pipeline | **Ashwath** | `apps/server/src/modules/live` | `KnowledgeEngine`, `SessionStore` | `MOCK_KNOWLEDGE`, `MOCK_PERSISTENCE` |
| CaptionEngine: jargon correction + spoken formula → LaTeX | **Ashwath** | same | `KnowledgeEngine` | `MOCK_KNOWLEDGE` |
| Sign gloss → sentence, TTS (ElevenLabs / Sarvam) | **Ashwath** | same | — | mock TTS |
| Deploy (Coolify), VPS Postgres + Qdrant, env | **Ashwath** → hands Qdrant to Tushar | `docker-compose*.yml` | — | local `infra:up` |
| Sessions, auth guard, DB schema, persistence | **Tushar** | `apps/server/src/modules/platform` + `packages/db` | `SessionLifecycle` | `MOCK_SPEECH` replay |
| Uploads, PDF/PPT → slide images + text | **Tushar** | same | — | mock slides |
| KnowledgeEngine: RAG over context (Qdrant), glossary | **Tushar** | same | — | local Qdrant |
| NotesEngine + notes job, export; board markers; placing snapshot images | **Tushar** | same | transcript + snapshots via `SessionStore` | replay lecture (`MOCK_CAPTIONS`) |
| Slide auto-pointer, smart snapshots (capture, vision description) | **Ashwath** | `apps/server/src/modules/live` + `packages/live-client` | deck via `SessionStore` | mock slides |
| Storage layer (S3 / local, presigned URLs) | **TBD** (scaffolded by Ashwath) | `apps/server/src/lib/storage.ts` | — | local driver |
| Session recordings: recorder + playback UI | **Sahil** | `apps/web` | recordings API | local driver |
| Session recordings: server API | **TBD** (scaffolded by Ashwath) | `apps/server/src/modules/recordings` | `SessionStore`, storage | — |
| `@sightline/contracts` | **Everyone (PR-reviewed)** | `packages/contracts` | — | — |

### Who relies on whom

```
Sahil ──REST/WS──► server ─┬─ live/ (Ashwath, core) ──KnowledgeEngine, SessionStore──► platform/ (Tushar)
  │                        └─ platform/ (Tushar) ──SessionLifecycle, SessionEvents──► live/ (Ashwath)
  ├─ws─► gaze bridge (Ashwath software on Arunya's tracker)
  └─ws─► sign service (Harnoor)

Every arrow is an interface with a mock behind a MOCK_* flag, so nobody blocks anybody.
```

## 5. Mock mode (how everyone starts on day one)

`apps/server/.env` has a master switch **`USE_MOCK_DATA=true`** plus optional per-module overrides:

| Flag | Owner | When `true` |
| --- | --- | --- |
| `USE_MOCK_DATA` | – | Default for every flag below |
| `MOCK_CAPTIONS` | Ashwath | Fixture-driven `MockCaptionEngine` (golden refinements + glossary fast path) |
| `MOCK_SPEECH` | Ashwath | STT replays a scripted lecture (no mic, no Deepgram); TTS returns a generated tone |
| `MOCK_KNOWLEDGE` | Tushar | Fixture glossary + naive retrieval instead of Qdrant |
| `MOCK_NOTES` | Tushar | Fixture notes linked to the real transcript |
| `MOCK_PERSISTENCE` | Tushar | In-memory store instead of Postgres; seeds a finished demo lecture |
| `MOCK_SLIDES` | Tushar | Any upload becomes the fixture deck rendered as SVG slides |
| `MOCK_AUTH` | Tushar | `/api` + `/ws` act as a fixed demo user (better-auth screens still work) |

Typical setups:

- **Sahil:** `USE_MOCK_DATA=true` → full API + live caption stream with zero services. Run
  `bun run mock:gaze` and `bun run mock:sign` for the device sockets.
- **Ashwath:** `USE_MOCK_DATA=true`, `MOCK_CAPTIONS=false` (then `MOCK_SPEECH=false`) → your real engines,
  Tushar's side mocked.
- **Tushar:** `USE_MOCK_DATA=true`, `MOCK_KNOWLEDGE=false`, `MOCK_NOTES=false` (then `MOCK_PERSISTENCE=false`,
  `MOCK_SLIDES=false`) → your real engines on local Qdrant/Postgres, fed by the replay lecture.
- **Harnoor:** `bun run sign:setup`, `sign:camera` for the direct backend tester; `sign:verify` and `sign:dev` for protocol integration. One public-data landmark alphabet model now recognizes across the frame. The current learner-oriented runtime requires a one-second steady letter hold and suppresses movement. Legacy model/CUDA dependencies are removed; the fast priority video now fails this timing. Fresh setup and WebSocket testing: apps/sign-service/README.md. See `implementation/alphabet-video-evaluation.md`.

Details, fixture list and the mock device servers: [`contracts/mock-mode.md`](contracts/mock-mode.md).

## 6. Repository layout

```
sightline/
├── apps/
│   ├── web/                  Sahil   — Next.js frontend
│   ├── server/               Ashwath + Tushar — Bun/Elysia API + WS
│   │   └── src/
│   │       ├── modules/live/          Ashwath (core)
│   │       ├── modules/platform/      Tushar (surrounding)
│   │       ├── shared/ports.ts        the seams between the two
│   │       └── container.ts           picks real vs mock implementations from the MOCK_* flags
│   ├── gaze-bridge/          Ashwath — Python, local gaze daemon (tracker hw: Arunya)
│   ├── speaker-service/      Ashwath — Python, local look-to-hear voice extraction (AV-MossFormer2)
│   └── sign-service/         Harnoor — one ASL A-Z classifier; supplied video acceptance currently fails
├── packages/
│   ├── contracts/            Everyone — zod schemas, TS types, JSON Schema export, typed clients
│   ├── mocks/                Fixtures (Kirchhoff lecture) + mock gaze/sign/speaker servers
│   ├── live-client/          Ashwath — browser mic, caption streaming, look-to-hear client
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
| M1 | Real tracker → gaze bridge → web pauses/resumes captions (mock server) | Arunya ↔ Ashwath ↔ Sahil |
| M2 | Real sign-service → web → mock compose → tone | Harnoor ↔ Sahil |
| M3 | Real Deepgram + real CaptionEngine → web captions (Tushar's side mocked) | Ashwath ↔ Sahil |
| M4 | Real KnowledgeEngine feeds live captions; real notes generated | Tushar ↔ Ashwath |
| M5 | Full demo run (Kirchhoff lecture) with hardware, flags all `false` | Demo ready |

Sign-service completion follow-up (2026-10-23): software regressions, CUDA FP16 execution and browser readiness are verified. Live M2 and the two-signer six-phrase acceptance remain open; see the [implementation record](implementation/sign-service-plan.md).

## 9. Tech stack

Bun · Elysia · Next.js 16 · better-auth · Postgres + Drizzle · Mastra · Qdrant (self-hosted) · Deepgram
(streaming STT, keyterm prompting) · Sarvam (Hinglish STT + TTS) · ElevenLabs (TTS) · Merge Gateway → GLM 5.3 Flash / GLM 4.5V (LLM + vision) · KaTeX (formula rendering) · Python
(gaze bridge, sign service: OpenCV / MediaPipe) · Docker → Coolify on our VPS.
