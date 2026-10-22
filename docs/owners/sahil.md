# Sahil — Frontend (everything the user sees)

> Back to [overview](../00-overview.md). **Start here: [frontend API contract](../contracts/frontend-api.md)** — every API
> the web app uses, its schema and where it's wired. Deep dives: [REST examples](../contracts/rest-api.md) ·
> [session socket](../contracts/realtime-ws.md) · [gaze bridge](../contracts/gaze-bridge.md) ·
> [sign service](../contracts/sign-service.md).

## Mission

Build the single-app student workspace: landing → auth → session setup → live lecture workspace (captions,
formulas, gaze-pause, slides, sign panel) → notes. Every screen can be built **today** against mocks.

## You own

All of [`apps/web`](../../apps/web) (Next.js 16, Tailwind 4, shadcn-style `packages/ui`, better-auth client).

| Screen | Key behaviour | Data |
| --- | --- | --- |
| Landing page | Pitch the 5 modules | static |
| Sign in / sign up | already scaffolded (better-auth) | `/api/auth/*` |
| Dashboard | Past sessions, "New lecture" | `listSessions` |
| Setup: hardware check | Bridge connected? calibrated? webcam + mic permission | gaze bridge `device.status`, `health` |
| Setup: calibration | Draw dots from `calibration.progress.target`, "look at the board" step | gaze bridge |
| Setup: context | Option A upload (+ preview) / Option B textarea; show glossary when READY | `uploadSlides`, `getSlides`, `setContextText`, `getContext` |
| Setup: mode | HoH / Deaf toggle (also live) | `updateSession` + bridge `mode.set` |
| Live workspace | Caption stream, KaTeX formulas, term tooltips, slide preview, focus indicator | session socket + gaze bridge |
| Gaze-pause (Deaf) | Pause scroll + bookmark on away, highlight missed lines, catch-up then resume | gaze bridge zones (client-side logic) |
| Sign panel | Webcam preview, live partial gloss, sentence, play audio, SELF/PEER toggle | sign service + `createSignUtterance` |
| HoH look-to-hear | Scene preview with face boxes, highlight the selected face, "listening to …", delay readout, earphone playback | [speaker service](../contracts/speaker-service.md) + gaze bridge `gaze.scene` + `createGazeTargetSelector` |
| Notes | Sections, formulas (KaTeX), definitions, BOARD callouts, **board snapshot images** (`image` blocks), export .md | `getNotes`, `notesExportUrl` |
| Slide pointer | On `slide.pointer`: flip the preview to `slideIndex`, highlight `bulletIndex` | session socket |
| **Session recording** (you own the recorder) | Record the eye-tracker scene camera (or webcam/screen) + mic while LIVE, in ~5-min self-contained segments; "● Recording" indicator + stop; playback page plays `segments[]` in order next to the transcript (seek by `startMs`) | [recordings contract](../contracts/recordings.md), `createRecordingUploader` |
| Snapshot toasts | On `snapshot.captured`: small thumbnail + reason; the description arrives in a second event | session socket |

## You do NOT own

Any server logic, recognition, or the LLM. If you need a field that doesn't exist, propose it in
`packages/contracts` (additive, optional) and ping Ashwath (live/captions/sign) or Tushar (sessions/slides/notes).

## What you consume: the web app's hooks

Types and REST client come straight from `@sightline/contracts`; `apps/web/src/lib/api.ts` is the typed client and
every call goes through a TanStack Query hook in `apps/web/src/hooks`. The workspace (`app/(workspace)/layout.tsx`)
mounts two providers so a running lecture survives page changes:

| Provider / hook | Talks to | Gives you |
| --- | --- | --- |
| `GazeProvider` → `useGaze()` | gaze bridge `:7777` (one connection for the whole workspace) | device status, `zone` (blinks ignored), `isAway`, calibration, `setMode`, `onTransition` / `onMessage` subscriptions |
| `LiveLectureProvider` → `useLiveLecture()` | session socket, mic, scene camera, recorder, voice focus, snapshots | `begin` / `end`, captions + gaze pause (`pause`, `resumeLive`), `recorder`, `voice`, `saveBoard`, `setMode` |
| `useSessionSocket(sessionId)` | server `/ws/sessions/:id` | ordered captions (refined in place, backfilled on (re)connect), slide pointer, notes status; utterances and snapshots go into their query caches |
| `useSignService({ onPhrase })` | sign service `:7788/ws` | hands detected, partial gloss, phrase tokens, `start` / `sendFrame` / `stop` / `reset` |
| `use-sessions.ts`, `use-lecture-data.ts` | REST | sessions, context, slides, transcript, notes, recordings, snapshots, sign utterances, health |

Pure logic with unit tests (`bun run --filter web test`): `lib/live/gaze-pause.ts` (pause / catch-up rules),
`lib/realtime/captions.ts` (merge: REFINED never downgraded), `lib/recordings/timeline.ts` (lecture time ↔ segment).

### Developing without hardware

`bun run dev:demo` starts the server with `USE_MOCK_DATA=true` plus the `packages/mocks` gaze, sign and speaker
services; then `bun run dev:web`. The sidebar badge shows which server modules are simulated (from `/api/health`).
The gaze mock reads its terminal's keys (`b` board, `s` screen, `p` person, `m` auto). `MOCK_SIGN_AUTO=1` makes the
sign mock recognise phrases without a webcam.

For the **mic, live captions and look-to-hear**, don't touch Web Audio yourself. Use `@sightline/live-client` (Ashwath's):

```ts
import { startMicCapture, streamMicToSession, startLookToHear } from "@sightline/live-client";

const mic = await startMicCapture();                         // after a user gesture (button)
const captions = streamMicToSession(live.socket!, mic);     // captions from the mic, via the session socket
const lth = await startLookToHear({
  mic, sceneVideo: videoEl,                                  // <video> showing the scene camera
  speakerUrl: process.env.NEXT_PUBLIC_SPEAKER_SERVICE_URL!,
  gazeBridgeUrl: process.env.NEXT_PUBLIC_GAZE_BRIDGE_URL!,
  onState: (s) => setLookToHear(s),                          // faces, targetId, status, playbackDelay
});
lth.select("face_id");                                       // click-to-select fallback

const snaps = startSmartSnapshots({                          // board/diagram frames → notes
  video: sceneVideoEl,
  upload: (image, fields) => api.uploadSnapshot(sessionId, image, fields),
});
// forward: session socket messages → snaps.onSessionMessage(m); gaze.zone → snaps.onGazeZone(m.zone)
// "Save board" button → snaps.capture("MANUAL")
await lth.stop(); captions.stop(); await mic.stop();
```

**Auth is verified end to end with your pages:** headless Chrome signed up through your `/sign-up` form, landed on
`/dashboard`, `/sign-in` redirected a signed-in user, and sign-out sent `/dashboard` back to `/sign-in`. Keep using
`authClient` + `credentials: "include"` (the API client already does). In production the server sets
`AUTH_COOKIE_DOMAIN` so your server-rendered pages see the session cookie.

All incoming messages are zod-validated; types are exhaustive discriminated unions. `@sightline/contracts` is
already a dependency of `apps/web`; add `katex` for formulas.

## How you work without anyone else

```bash
cp apps/server/.env.example apps/server/.env    # USE_MOCK_DATA=true is the default
bun run dev:server                              # MOCK_REPLAY_SPEED=2 in .env for faster captions
bun run dev:web
bun run mock:gaze                               # press b (board) / s (screen) to test gaze-pause by hand
bun run mock:speaker                            # look-to-hear: 2 fake faces, echoes mic audio as "focused"
MOCK_SIGN_AUTO=1 bun run mock:sign              # sign tokens without a webcam
```

- A finished **demo lecture** is already in the dashboard (notes READY, slides, transcript).
- Start any new session → captions replay the Kirchhoff lecture with real mistakes being corrected
  (`caption.final` → `caption.refined`), formulas, and slide pointers.
- Upload **any** PDF → you get the 6-slide fixture deck (SVG images).
- Sign utterances return a chime WAV as `audioUrl`; in mock mode also speak `text` with `speechSynthesis`
  if you want to hear words.

## UX rules that matter for the judges

- Captions are the hero: big readable type, high contrast, formulas rendered as blocks, never jumpy.
- `caption.refined` replaces in place — animate the correction subtly (e.g. underline that fades).
- Gaze-pause must be obvious: frozen scroll, a bookmark line, missed lines highlighted, a "you missed N lines"
  pill, then smooth resume. Ignore `UNKNOWN` (blinks).
- Everything works with keyboard only; respect `prefers-reduced-motion`.

## Done when

- [ ] Every screen above works end-to-end on mocks (checkpoint **M0**)
- [ ] Switching to the real gaze bridge / Harnoor's real service needs only the env URLs (M1, M2)
- [ ] Demo run with all flags `false` (M5)
