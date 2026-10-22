# Sahil — Frontend (everything the user sees)

> Back to [overview](../00-overview.md). Contracts you consume: [REST](../contracts/rest-api.md) ·
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

REST goes through TanStack Query hooks in `apps/web/src/hooks` (built on `lib/api.ts`). The three JSON sockets
have their own hooks; message types live in `apps/web/src/types/realtime.ts` and mirror the protocol docs.

| Hook | Socket | Gives you |
| --- | --- | --- |
| `useSessionSocket(sessionId)` | server `/ws/sessions/:id` | ordered captions (refined in place, backfilled after reconnects), interim line, slide pointer, sign utterances, snapshots, notes status, `send`, raw `socket` |
| `useGazeBridge({ onTransition })` | gaze bridge `:7777` | device status, `zone` (blinks ignored), `isAway`, targets, calibration, `setMode`, `startCalibration` |
| `useSignService({ onPhrase })` | sign service `:7788/ws` | vocabulary, hands detected, partial gloss, phrase tokens, `start` / `sendFrame` / `stop` / `reset` |
| `useCreateSignUtterance(sessionId)` | REST | phrase tokens → sentence + audio |

```ts
const live = useSessionSocket(sessionId, { onMessage: (m) => snapshots.onSessionMessage(m) });
const gaze = useGazeBridge({
  onTransition: (transition) => live.send({ type: "gaze.transition", transition, ts: Date.now() }),
});
const utter = useCreateSignUtterance(sessionId);
const sign = useSignService({ onPhrase: (tokens, source) => utter.mutate({ tokens, source }) });
// webcam → sign: startWebcamFrames(videoEl, { fps: 12, width: 640, height: 480 }, sign.sendFrame) after sign.start()
```

`NEXT_PUBLIC_MOCK_MODE=true` swaps every socket for a scripted mock in the browser (`apps/web/src/mocks/realtime`):
a Kirchhoff lecture with corrections and formulas, a gaze timeline with calibration, and repeating sign phrases.
No server or device services needed.

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
