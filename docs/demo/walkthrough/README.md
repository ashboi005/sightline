# Walkthrough video

A 51-second, scripted product walkthrough for the pitch: landing → sign in → new lecture → slide upload and glossary →
live captions with spoken formulas → look at the board (captions pause, missed lines highlighted, resume) → sign
language page (fingerspell a question, spoken aloud) → the teacher's answer in the captions → end lecture → generated
notes and the recording. Nothing in it is live: no camera, mic or server.

- `walkthrough.html`: the animation. Every frame is a function of time; open it with `?play` to watch it in a browser,
  or `?t=21.5` to jump to a moment. Change the timing in `T`, `LINES`, `CURSOR`, `CAM` and `CHIPS` at the bottom.
- `render.mjs`: captures it frame by frame at 1920×1080, 30 fps, and encodes `sightline-walkthrough.mp4`.

Re-render (from a folder where `playwright` is installed, with ffmpeg on PATH):

```bash
node docs/demo/walkthrough/render.mjs docs/demo/walkthrough/sightline-walkthrough.mp4 --channel chrome
```

Voiceover: `voiceover.json` holds the narration lines and when each starts (George, `eleven_v4`). `voiceover.mjs`
generates them with ElevenLabs and mixes them into `sightline-walkthrough-voiceover.mp4`. It prints each line's length
and warns when one runs into the next, so you can retime it. A line can set its own `voice_id` (the signed question
is spoken in Sarah's voice, as the laptop). Clips are cached in `voiceover-clips/` by voice and text.

```bash
node docs/demo/walkthrough/voiceover.mjs docs/demo/walkthrough/sightline-walkthrough.mp4 docs/demo/walkthrough/sightline-walkthrough-voiceover.mp4 --env apps/server/.env
```

`--stills 12,21.5,29` writes PNGs at those times instead, for checking a change. The page loads its fonts and KaTeX
from Google Fonts and cdnjs, so rendering needs a network connection.
