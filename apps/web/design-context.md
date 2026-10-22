# Sightline design context

How Sightline's web app looks, sounds and behaves. Read this before building or changing any screen in `apps/web`,
and make new work indistinguishable from what's already here. Token values live in
`packages/ui/src/styles/globals.css`; shared components live where the tables below point.

## The product, in one breath

Sightline is a lecture workspace for **deaf and hard-of-hearing students**: gaze-aware live captions, subject-aware
terms and formulas, voice focus, sign-to-speech, recordings and generated notes. Users are university students and
younger learners. The design has to feel **welcoming and tactile** while staying **effortless to read** for long
stretches. Readability always wins over decoration.

The visual motif is classroom material: a **highlighter** (marigold marks what you missed), a **gaze point on a line
of text** (the logo), chalk dots, and soft clay-like objects you want to press.

## The core rule: clay chrome, flat reading surfaces

Every element is one of two kinds. Decide which before styling it.

- **Clay chrome**: navigation, cards, controls, tiles, panels, empty states. Soft volume: subtle gradient, inner
  highlight, soft outer shadow, generous varied radii, sinks a little when pressed.
- **Reading surfaces**: captions, transcripts, slides, video, long-form notes, forms' text. Flat, solid,
  high-contrast (`bg-card` white in light mode). A clay *frame* around them is fine (`shadow-[var(--clay-shadow-sm)]`
  on the container); the reading area itself stays flat, with nothing decorative behind or inside it.

## Colour

| Name | Token / Tailwind | Role |
| --- | --- | --- |
| Chalk `#F3F4F1` | `bg-background` | Page background (light) |
| Ink `#16181C` | `text-foreground` | All body text; also text *on* marigold |
| White `#FFFFFF` | `bg-card` | Reading surfaces and clay cards |
| Marigold `#F5B301` | `bg-marigold`, `clay-marigold`, `bg-primary` | The highlighter: primary actions, selected state, focus ring, "missed" highlights (`bg-highlight`), the live gaze dot |
| Umber `#8A5A00` | `text-marigold-ink` | Marigold as *text or icons* on light surfaces (marigold itself is too light to read) |
| Sage `#DFEADF` | `bg-sage`, `clay-sage`, `text-sage-ink` | Ready / done / devices / notes |
| Lilac `#E8E2F6` | `bg-lilac`, `clay-lilac`, `text-lilac-ink` | In progress / recordings / sign language / demo-data notices |
| Live red | `bg-live`, `text-live` | Only for "live now" and "recording" |
| Slate `#181C21` | `bg-slate` | Dark backgrounds (dark mode, webcam/video wells, the auth side panel) |

Colour rules:

- Each workspace destination has a tone (Dashboard and Live lecture: marigold; Setup and Notes: sage; Recordings and
  Sign: lilac). Use the tone for that area's icon tiles and accents. Defined in `src/components/workspace/nav.ts`.
- Status is always **text + icon**, with colour as the third signal: use `StatusPill`.
- Text on pastel surfaces is ink or the matching `*-ink` colour, never muted grey on lilac/sage.
- Avoid blue, purple and green as brand colours. Sage and lilac are soft supporting pastels, not accents.
- **Dark mode** is a deliberate chalkboard: every token is redefined under `.dark` in `globals.css`. Use tokens and
  utilities only (no raw hex in components) and dark mode comes free. The default theme is light; users switch with
  the theme toggle.

## Type

- One family: **Atkinson Hyperlegible Next** (drawn for low-vision readers). **Atkinson Hyperlegible Mono** only for
  real data: caption timestamps, gloss tokens (`PLEASE REPEAT`), clocks.
- Page title: `text-[1.75rem] sm:text-[2.125rem] font-extrabold tracking-[-0.025em]` (via `PageHeader`).
- Section title: `text-lg`–`text-xl font-bold tracking-tight` (via `SectionTitle`).
- Body: `text-base`/`text-[1.0625rem]`, `leading-relaxed`; muted copy uses `text-muted-foreground`.
- Captions are the largest reading text: `text-xl` to `text-[2.125rem]`, user-adjustable, `leading-[1.5]`,
  `font-medium`.
- Long-form notes: `max-w-[68ch]`, `leading-[1.7]`. Keep prose under ~75 characters per line.
- Formulas always render with KaTeX through `<Formula tex=… display?>` (`src/components/formula.tsx`); block
  formulas sit in a soft `bg-muted/60` well.
- Sentence case everywhere. No all-caps labels or eyebrow text (the only exception is the tiny `LIVE` badge).

## Shape, depth and spacing

Clay utilities (defined in `globals.css`; pair each with a rounded class):

| Utility | Use for |
| --- | --- |
| `clay` | Primary raised surfaces: cards, sidebar shell, panels |
| `clay-sm` | Smaller raised things: selected nav item, list cards, chips that rise |
| `clay-sunken` | Wells: empty states, placeholders, tab tracks |
| `clay-marigold` | Primary action and the one highlighted card on a page |
| `clay-sage` / `clay-lilac` | Tinted quick actions, selected list items, icon tiles |
| `clay-press` | Anything clickable built from the above: it sinks on `:active` |

Radius follows hierarchy, larger outside, smaller inside:

- Sidebar shell and hero cards: `rounded-[2rem]`
- Cards: `rounded-[1.6rem]`–`rounded-[1.75rem]`
- Panels: `rounded-[1.5rem]`
- Controls: `Button`, `Input`, `Textarea`, native `<select>` and menus are `rounded-2xl` at 36–44px tall;
  `sm` buttons and menu items `rounded-xl`; 24px chips `rounded-lg`
- Icon tiles: about `0.9rem`

Spacing is generous: card padding `p-5`–`p-8`, page sections `space-y-6`, grids `gap-4`–`gap-6`.

Buttons (`@sightline/ui/components/button`):

- `variant="clay"`: marigold. One primary action per area.
- `variant="clay-soft"`: white clay. Secondary actions.
- `variant="ghost"`: toolbar and icon actions.
- `variant="destructive"`: End lecture, Sign out anyway.
- Sizes: `sm`, default, `lg` (hero CTAs), `icon` / `icon-sm`.
- The size owns the radius. `cn` does not merge Tailwind classes, so never add a second `rounded-*` to a
  button, input or skeleton through `className`: two radius classes resolve by stylesheet order, which differs
  between pages. Change the kit component instead.
- For a link styled as a button, use `className={buttonVariants({ variant: "clay" })}` on a Next `<Link>`.

## Decoration: Memphis accents and the backdrop

- Shapes come from `src/components/clay/memphis.tsx`: `Squiggle`, `DotGrid`, `HalfDisc`, `GazeLine` (the motif).
- Place them only in **welcome areas** (dashboard hero, finished-lecture card), **empty states** (`EmptyState`
  includes them), and the **workspace backdrop** (`src/components/workspace/backdrop.tsx`): chalk-dot texture,
  corner colour washes and shapes kept to the edges.
- Shapes sit at the edges, often partly off-canvas, at low opacity (`text-*/20`–`/50`), `aria-hidden`, never under
  text. One or two per area; a page should never feel busy.

## Motion

Motion explains a change; it is never ambient decoration. The existing vocabulary in `src/index.css`:

- `sl-line-in`: a new caption or line arriving (small rise + fade).
- `sl-refined`: marigold underline drawn under a corrected caption word, then fading.
- `sl-progress`: indeterminate progress bar.
- `clay-press`: tactile press on clickable clay.
- `sl-rise` / `sl-draw`: landing page entrance only.
- Status spinners use `animate-spin`, and the live dot uses `animate-ping`.

Every animation also has a `motion-reduce:` fallback. `globals.css` neutralises animation globally under
`prefers-reduced-motion`, and smooth scrolling checks it too.

## Components to reuse

| Need | Use | Path |
| --- | --- | --- |
| Raised card | `ClayCard tone="plain\|marigold\|sage\|lilac"` | `src/components/clay/clay.tsx` |
| Icon in a clay square | `IconTile icon tone size` | same |
| Status (text + icon) | `StatusPill kind="ready\|working\|attention\|idle\|live"` | same |
| Page title row | `PageHeader icon tone title description actions` | same |
| Section heading with aside | `SectionTitle aside` | same |
| Error with next step | `InlineAlert action` | same |
| Empty screen | `EmptyState icon title action` | `src/components/clay/empty-state.tsx` |
| Dialog / confirm / sheet | `Dialog`, `AlertDialog`, `DialogContent side="left"` | `packages/ui/src/components/dialog.tsx` |
| Tabs (sunken track, raised tab) | `Tabs`, `TabsList`, `TabsTab`, `TabsPanel` | `packages/ui/src/components/tabs.tsx` |
| Tap-to-explain | `Popover` | `packages/ui/src/components/popover.tsx` |
| Tooltip in the icon rail | `RailTip` | `src/components/workspace/rail-tip.tsx` |
| Caption parts (terms, formulas) | `CaptionText` | `src/components/lecture/caption-text.tsx` |
| Generated notes | `NotesReader` (`compact` for side panels) | `src/components/notes/notes-reader.tsx` |
| Sign to speech | `SignPanel variant="page\|panel"` | `src/components/sign/sign-panel.tsx` |
| Dates, durations, status labels | `formatWhen`, `lectureMinutes`, `sessionStatus`, `processingLabel` | `src/lib/format.ts` |

Extend these rather than restyling a one-off; add to `packages/ui` only when a primitive is reusable app-wide.

## Page patterns

- **Shell**: every signed-in page lives in `app/(workspace)` and gets the sidebar, backdrop, auth gate and the
  running lecture for free. The sidebar collapses to an icon rail on desktop and becomes a drawer below `lg`.
- **Page skeleton**: `<div className="mx-auto max-w-6xl space-y-6">` → `PageHeader` → content in `ClayCard`s. Widths:
  forms `max-w-3xl`; dashboard and preparation `max-w-6xl`; notes and recordings `max-w-7xl`; the live lecture uses
  nearly full width.
- **Two-column pages** pair a main column with a sticky side column (`lg:grid-cols-[minmax(0,1fr)_22–26rem]`,
  `lg:sticky lg:top-6`). On small screens, stack them or switch to `Tabs`, mounting one layout at a time
  (`useMediaQuery`) when a panel owns a device or socket.
- **States**, every data view has all four:
  - Loading: `Skeleton` with the final layout's rounded shape.
  - Empty: `EmptyState` saying what goes here and how to get it.
  - Error: `InlineAlert` saying what happened, with a retry action.
  - Processing: a `working` `StatusPill` or the lilac notice, with polling handled by the query hook.
- **Simulated data is labelled**: the sidebar badge reads `/api/health`, and mock services say so in their panels
  (e.g. "Mock voice service"). Keep demo data distinguishable from real data in any new screen.

## Voice and copy

- Plain verbs, sentence case, written from the student's side: "Start lecture", "Return to lecture", "Resume live",
  "Save board", "Open notes".
- An action keeps its name through the flow: the "Create account" button goes with the "Account created" toast.
- Errors say what happened and what to do next ("Sightline isn't allowed to use your camera. Allow it in your
  browser's site settings, then try again."), in the interface's voice, without apologising.
- Empty states invite the next step. Describe capability honestly: face tracks are "face 1", not people's names.
- Audio for hard-of-hearing users goes to their **hearing aids** (not "earphones").

## Accessibility

A screen is done when:

- Every control works from the keyboard with a visible `focus-visible:ring-2 ring-ring` and a descriptive accessible
  name (icon-only buttons have `aria-label`).
- Status is text + icon; live changes that matter use `aria-live="polite"` or `role="status"`.
- Touch targets are at least 40px (`min-h-10`/`min-h-11`, `size-9`+).
- Text contrast holds on every surface in both themes.
- Motion has a reduced-motion fallback.
- Decorative SVGs are `aria-hidden`.

## Landing and auth pages

`/`, `/sign-in` and `/sign-up` share the palette and type but are flatter and more editorial: no clay chrome, a
centred marketing layout, the animated caption demo as the hero, and the `sl-rise` entrance. Workspace pages are the
clay world. Keep the two families distinct.

## Building a new screen: checklist

1. It lives in `app/(workspace)/…` and starts with `PageHeader` in the destination's tone.
2. Chrome is clay; reading content is flat on `bg-card`.
3. It reuses the components above, with one `clay` primary action per area.
4. Loading, empty, error and processing states all exist.
5. Data comes through TanStack Query hooks in `src/hooks` (types from `@sightline/contracts`; see
   `docs/owners/sahil.md` for the data layer).
6. It reads well at 390px wide and in dark mode, and passes the accessibility list above.
