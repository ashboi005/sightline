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
| Notes | Sections, formulas (KaTeX), definitions, BOARD callouts, export .md | `getNotes`, `notesExportUrl` |

## You do NOT own

Any server logic, recognition, or the LLM. If you need a field that doesn't exist, propose it in
`packages/contracts` (additive, optional) and ping Tushar/Ashwath.

## What you consume — use the ready-made clients

```ts
import { createSightlineApi, connectSessionSocket, connectGazeBridge, connectSignService } from "@sightline/contracts/client";
import type { CaptionSegment, GazeZone, SignToken } from "@sightline/contracts";

const api = createSightlineApi({ baseUrl: process.env.NEXT_PUBLIC_SERVER_URL! });
const session = await api.createSession({ title: "EE101 · Lecture 7", mode: "DEAF" });
await api.startSession(session.id);

const socket = connectSessionSocket(process.env.NEXT_PUBLIC_SERVER_WS_URL!, session.id, {
  onMessage: (m) => { /* switch (m.type) { case "caption.final": … case "caption.refined": … } */ },
});
const gaze = connectGazeBridge(process.env.NEXT_PUBLIC_GAZE_BRIDGE_URL!, {
  onMessage: (m) => { if (m.type === "gaze.zone") { /* pause/resume + socket.send({ type: "gaze.transition", … }) */ } },
});
```

All incoming messages are zod-validated; types are exhaustive discriminated unions. `@sightline/contracts` is
already a dependency of `apps/web`; add `katex` for formulas.

## How you work without anyone else

```bash
cp apps/server/.env.example apps/server/.env    # USE_MOCK_DATA=true is the default
bun run dev:server                              # MOCK_REPLAY_SPEED=2 in .env for faster captions
bun run dev:web
bun run mock:gaze                               # press b (board) / s (screen) to test gaze-pause by hand
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
- [ ] Switching to Arun's real bridge / Harnoor's real service needs only the env URLs (M1, M2)
- [ ] Demo run with all flags `false` (M5)
