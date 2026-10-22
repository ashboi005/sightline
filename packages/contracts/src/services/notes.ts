/**
 * NotesEngine — OWNER: Tushar. Post-lecture structured notes (module 5) + P1 board-heavy markers.
 * Called from a background job after a session ends. MOCK_NOTES=true swaps in the fixture-backed mock.
 * Uses the KnowledgeEngine (also Tushar's) for slide/topic grounding.
 */
import { z } from "zod";

import { CaptionSegment } from "../domain/captions";
import { ContextState, Slide } from "../domain/context";
import { AwayWindow } from "../domain/gaze";
import { LectureNotes } from "../domain/notes";
import { Session } from "../domain/session";
import { Snapshot } from "../domain/snapshots";

export const GenerateNotesInput = z.object({
  session: Session,
  context: ContextState,
  slides: z.array(Slide),
  /** Full REFINED transcript produced by Ashwath's live pipeline, ordered by seq. */
  transcript: z.array(CaptionSegment),
  /** When the student looked away from the screen (BOARD windows → P1 board markers). */
  awayWindows: z.array(AwayWindow),
  /** Board/diagram snapshots captured live (Ashwath's pipeline) — place them as `image` blocks. */
  snapshots: z.array(Snapshot).default([]),
});
export type GenerateNotesInput = z.infer<typeof GenerateNotesInput>;

export type NotesDraft = Omit<LectureNotes, "id" | "generatedAt">;

export interface NotesEngine {
  readonly name: string;
  /** May take ~30–60 s. Throw on failure; the job marks notes FAILED. */
  generateNotes(input: GenerateNotesInput): Promise<NotesDraft>;
}
