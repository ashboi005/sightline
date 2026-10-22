# Mock mode, fixtures and mock services

Goal: **nobody waits on anybody.** Every boundary has a mock that speaks the real contract.

## Server flags (`apps/server/.env`)

| Flag | Default | `true` means | Real implementation owner |
| --- | --- | --- | --- |
| `USE_MOCK_DATA` | `true` | Master switch; every flag below inherits it when left empty | – |
| `MOCK_INTELLIGENCE` | ← master | `MockIntelligenceEngine` (fixture refinements, glossary-alias fallback, fixture notes) | Ashwath |
| `MOCK_SPEECH` | ← master | `MockReplayStt` replays the Kirchhoff lecture on session start (mic not needed) + `MockTts` chime WAV | Tushar |
| `MOCK_PERSISTENCE` | ← master | In-memory store + in-memory assets (lost on restart) | Tushar |
| `MOCK_SLIDES` | ← master | Any upload → the fixture deck rendered as SVG slides | Tushar |
| `MOCK_AUTH` | ← master | `/api` + `/ws` act as `usr_demo` (better-auth routes still work) | Tushar |
| `MOCK_REPLAY_SPEED` | `1` | Replay speed multiplier (`4` = 4× faster for UI work) | – |

`GET /api/health` reports what is mocked; the server also prints it on boot:

```
modules: intelligence=MOCK  speech=MOCK  persistence=MOCK  slides=MOCK  auth=MOCK
```

With `MOCK_PERSISTENCE` + `MOCK_AUTH` a finished **demo lecture** is seeded on boot (transcript, slides,
glossary, a board-gaze window, notes) so the dashboard and notes pages have data instantly.

Real implementations that aren't built yet throw `NOT_IMPLEMENTED` (HTTP 501) with the owner's name —
flip the matching flag to `true` to keep working.

## Recommended setups

| Who | Flags | Also run |
| --- | --- | --- |
| Sahil (frontend) | `USE_MOCK_DATA=true`, `MOCK_REPLAY_SPEED=2` | `bun run mock:gaze`, `bun run mock:sign` |
| Tushar (platform) | `USE_MOCK_DATA=false`, `MOCK_INTELLIGENCE=true` | `bun run infra:up` (Postgres + Qdrant) |
| Ashwath (intelligence) | `USE_MOCK_DATA=true`, `MOCK_INTELLIGENCE=false` | `bun run infra:up` (Qdrant) |
| Arun (gaze) | – | his bridge on :7777 + web app (or `apps/gaze-bridge` skeleton) |
| Harnoor (sign) | – | her service on :7788 + web app |
| Demo | everything `false` | all services |

## Fixtures (`packages/mocks/fixtures/`)

Validated against the contracts on import (`bun run mock:validate`). Plain JSON so Python can read them too.

| File | Contents | Used by |
| --- | --- | --- |
| `kirchhoff.context.json` | session meta, context text, topics, 12 glossary terms (with mis-hearing aliases), STT keyterms | mock intelligence, seed |
| `kirchhoff.slides.json` | 6-slide deck (titles + bullets) | mock slide processor |
| `kirchhoff.script.json` | 20 timed lecture lines: `raw` STT text (with mistakes like "kerchief's", "homes law", "mash analysis") and the expected `refined` parts incl. LaTeX formulas, plus slide pointers | replay STT, mock refine, **Ashwath's golden test set** |
| `kirchhoff.notes.json` | Full `LectureNotes` for the lecture | mock notes, Sahil's notes UI |
| `sign.phrases.json` | Vocabulary + 6 gloss phrases with expected sentences | mock sign service, mock compose, Harnoor's target vocab |
| `gaze.timeline.json` | Focus targets + looping zone timeline (BOARD during the board example) | mock gaze bridge |

## Mock device services

```bash
bun run mock:gaze     # ws://localhost:7777 — auto timeline; keys: s b p a u (manual), m (auto), q
bun run mock:sign     # ws://localhost:7788/ws — recognises scripted phrases while frames stream in
MOCK_SIGN_AUTO=1 bun run mock:sign   # …or on a timer without any frames
```

## Contract check

```bash
MOCK_REPLAY_SPEED=4 bun run dev:server      # in one terminal
bun run --filter server smoke               # in another — every REST + WS message is schema-validated
```
