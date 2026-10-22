# Mock mode, fixtures and mock services

Goal: **nobody waits on anybody.** Every boundary has a mock that speaks the real contract.

## Server flags (`apps/server/.env`)

| Flag | Default | `true` means | Real implementation owner |
| --- | --- | --- | --- |
| `USE_MOCK_DATA` | `true` | Master switch; every flag below inherits it when left empty | – |
| `MOCK_CAPTIONS` | ← master | `MockCaptionEngine`: golden refinements for known lines, glossary fast path for anything else, fixture sign sentences | Ashwath |
| `MOCK_SPEECH` | ← master | `MockReplayStt` replays the Kirchhoff lecture on session start (mic not needed) + `MockTts` chime WAV | Ashwath |
| `MOCK_KNOWLEDGE` | ← master | `MockKnowledgeEngine`: fixture glossary/topics, word-overlap retrieval (slide pointer is Ashwath's real locator in every mode) | Tushar |
| `MOCK_NOTES` | ← master | `MockNotesEngine`: fixture notes linked to the real transcript + board markers | Tushar |
| `MOCK_PERSISTENCE` | ← master | In-memory store + in-memory assets (lost on restart) | Tushar |
| `MOCK_SLIDES` | ← master | Any upload → the fixture deck rendered as SVG slides | Tushar |
| `MOCK_AUTH` | ← master | `/api` + `/ws` act as `usr_demo` (better-auth routes still work) | Tushar |
| `MOCK_REPLAY_SPEED` | `1` | Replay speed multiplier (`4` = 4× faster for UI work) | – |

Related (real mode): `CAPTIONS_USE_RAG` (default `false`) keeps Tushar's RAG out of the live path until it's ready; `DEEPGRAM_URL` points STT at a fake/regional endpoint (used by `check:pipeline`).

`GET /api/health` reports what is mocked; the server also prints it on boot:

```
modules: captions=MOCK  speech=MOCK  knowledge=MOCK  notes=MOCK  persistence=MOCK  slides=MOCK  auth=MOCK
```

With `MOCK_PERSISTENCE` + `MOCK_AUTH` a finished **demo lecture** is seeded on boot (transcript, slides,
glossary, a board-gaze window, notes) so the dashboard and notes pages have data instantly.

Real implementations that aren't built yet throw `NOT_IMPLEMENTED` (HTTP 501) with the owner's name —
flip the matching flag to `true` to keep working.

## Recommended setups

| Who | Flags | Also run |
| --- | --- | --- |
| Sahil (frontend) | `USE_MOCK_DATA=true`, `MOCK_REPLAY_SPEED=2` | `bun run mock:gaze`, `bun run mock:sign`, `bun run mock:speaker` |
| Ashwath (core) | `USE_MOCK_DATA=true`, `MOCK_CAPTIONS=false`, later `MOCK_SPEECH=false` | gaze bridge on :7777 |
| Tushar (surrounding) | `USE_MOCK_DATA=true`, `MOCK_KNOWLEDGE=false`, `MOCK_NOTES=false`, later `MOCK_PERSISTENCE=false` | `bun run infra:up` (local Qdrant + Postgres) |
| Harnoor (sign) | – | her service on :7788 + web app |
| Demo | everything `false` | all services |

## Fixtures (`packages/mocks/fixtures/`)

Validated against the contracts on import (`bun run mock:validate`). Plain JSON so Python can read them too.

| File | Contents | Used by |
| --- | --- | --- |
| `kirchhoff.context.json` | session meta, context text, topics, 12 glossary terms (with mis-hearing aliases), STT keyterms | mock knowledge, seed |
| `kirchhoff.slides.json` | 6-slide deck (titles + bullets) | mock slide processor |
| `kirchhoff.script.json` | 20 timed lecture lines: `raw` STT text (with mistakes like "kerchief's", "homes law", "mash analysis") and the expected `refined` parts incl. LaTeX formulas, plus slide pointers | replay STT, mock captions, **Ashwath's golden test set** |
| `kirchhoff.notes.json` | Full `LectureNotes` for the lecture | mock notes, **Tushar's quality target**, Sahil's notes UI |
| `sign.phrases.json` | Vocabulary + 6 gloss phrases with expected sentences | mock sign service, mock compose, Harnoor's target vocab |
| `gaze.timeline.json` | Focus targets + looping zone timeline (BOARD during the board example) | mock gaze bridge |

## Mock device services

```bash
bun run mock:gaze     # ws://localhost:7777 — auto timeline; keys: s b p a u (manual), m (auto), q
bun run mock:sign     # ws://localhost:7788/ws — recognises scripted phrases while frames stream in
bun run mock:speaker  # ws://127.0.0.1:7799/live — 2 fixed faces; echoes mic PCM as "focused" after 600 ms
MOCK_SIGN_AUTO=1 bun run mock:sign   # …or on a timer without any frames
```

## Contract check

```bash
MOCK_REPLAY_SPEED=4 bun run dev:server      # in one terminal
bun run --filter server smoke               # in another — every REST + WS message is schema-validated
```
