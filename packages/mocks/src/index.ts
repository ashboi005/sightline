/**
 * Typed, validated access to the shared mock fixtures (packages/mocks/fixtures/*.json).
 * Every fixture is parsed against @sightline/contracts at import time, so a contract change that breaks
 * a fixture fails loudly instead of silently feeding bad data to the UI.
 */
import {
  CaptionCorrection,
  CaptionPart,
  ContextState,
  FocusTarget,
  GazeZone,
  GlossaryTerm,
  LectureNotes,
  SignSource,
  SignToken,
  SlideBullet,
  SlidePointer,
} from "@sightline/contracts";
import { z } from "zod";

import contextJson from "../fixtures/kirchhoff.context.json";
import notesJson from "../fixtures/kirchhoff.notes.json";
import scriptJson from "../fixtures/kirchhoff.script.json";
import slidesJson from "../fixtures/kirchhoff.slides.json";
import gazeJson from "../fixtures/gaze.timeline.json";
import signJson from "../fixtures/sign.phrases.json";

export const LectureContextFixture = z.object({
  session: z.object({ title: z.string(), subject: z.string(), mode: z.enum(["HARD_OF_HEARING", "DEAF"]) }),
  contextText: z.string(),
  topics: ContextState.shape.topics,
  glossary: z.array(GlossaryTerm),
  sttKeyterms: z.array(z.string()),
});

export const SlidesFixture = z.object({
  fileName: z.string(),
  slides: z.array(
    z.object({ index: z.number().int(), title: z.string(), bullets: z.array(z.string()) }),
  ),
});

export const ScriptSegmentFixture = z.object({
  atMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  speaker: z.string(),
  raw: z.string(),
  refined: z.object({
    text: z.string(),
    parts: z.array(CaptionPart),
    corrections: z.array(CaptionCorrection),
    confidence: z.number(),
  }),
  slidePointer: SlidePointer.nullable(),
});
export type ScriptSegmentFixture = z.infer<typeof ScriptSegmentFixture>;

export const LectureScriptFixture = z.object({
  loopGapMs: z.number().int().nonnegative(),
  segments: z.array(ScriptSegmentFixture).min(1),
});

export const GazeTimelineFixture = z.object({
  targets: z.array(FocusTarget),
  steps: z.array(
    z.object({ zone: GazeZone, targetId: z.string().nullable(), durationMs: z.number().int().positive() }),
  ),
});

export const SignPhraseFixture = z.object({
  source: SignSource,
  tokens: z.array(SignToken.pick({ gloss: true, kind: true, confidence: true })).min(1),
  text: z.string(),
  alternatives: z.array(z.string()),
});
export type SignPhraseFixture = z.infer<typeof SignPhraseFixture>;

export const SignPhrasesFixture = z.object({
  vocabulary: z.array(z.string()),
  phrases: z.array(SignPhraseFixture).min(1),
});

export const NotesFixture = LectureNotes.omit({ id: true, sessionId: true, generatedAt: true });

export const fixtures = {
  lecture: {
    context: LectureContextFixture.parse(contextJson),
    slides: SlidesFixture.parse(slidesJson),
    script: LectureScriptFixture.parse(scriptJson),
    notes: NotesFixture.parse(notesJson),
  },
  gaze: GazeTimelineFixture.parse(gazeJson),
  sign: SignPhrasesFixture.parse(signJson),
} as const;

/** Slide fixture → contract `SlideBullet[]`. */
export function toSlideBullets(bullets: string[]): z.infer<typeof SlideBullet>[] {
  return bullets.map((text, index) => ({ index, text }));
}

let idCounter = 0;
/** Short unique id with a contract prefix ("ses", "seg", "tok", …). */
export function mockId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(4, "0")}`;
}
