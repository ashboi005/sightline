// `bun run --filter @sightline/mocks validate` — parses every fixture against the contracts.
import { fixtures } from "./index";

console.log(
  `fixtures OK: ${fixtures.lecture.script.segments.length} caption segments, ` +
    `${fixtures.lecture.slides.slides.length} slides, ${fixtures.lecture.context.glossary.length} glossary terms, ` +
    `${fixtures.sign.phrases.length} sign phrases, ${fixtures.gaze.steps.length} gaze steps`,
);
