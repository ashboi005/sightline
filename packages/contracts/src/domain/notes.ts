import { z } from "zod";

import { NotesId, SegmentId, SessionId, Timestamp } from "./common";
import { ProcessingStatus } from "./session";

export const NoteBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string()) }),
  z.object({ type: z.literal("definition"), term: z.string(), definition: z.string() }),
  z.object({ type: z.literal("formula"), latex: z.string(), caption: z.string().nullable() }),
  /** A board/diagram snapshot captured during the lecture (see domain/snapshots.ts). */
  z.object({
    type: z.literal("image"),
    snapshotId: z.string(),
    url: z.string(),
    caption: z.string().nullable(),
  }),
  z.object({
    type: z.literal("callout"),
    variant: z.enum(["TIP", "WARNING", "BOARD"]),
    text: z.string(),
  }),
]);
export type NoteBlock = z.infer<typeof NoteBlock>;

export const NoteSection = z.object({
  id: z.string(),
  heading: z.string(),
  blocks: z.array(NoteBlock),
  /** Caption segments this section was built from (lets the UI jump back to the transcript). */
  sourceSegmentIds: z.array(SegmentId),
  slideIndexes: z.array(z.number().int().nonnegative()),
  /** P1 — set when the student spent a long time looking at the board during this section. */
  boardFocus: z
    .object({ isBoardHeavy: z.boolean(), awaySeconds: z.number().nonnegative() })
    .nullable(),
});
export type NoteSection = z.infer<typeof NoteSection>;

export const LectureNotes = z.object({
  id: NotesId,
  sessionId: SessionId,
  title: z.string(),
  summary: z.string(),
  sections: z.array(NoteSection),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })),
  formulas: z.array(z.object({ latex: z.string(), description: z.string() })),
  takeaways: z.array(z.string()),
  /** Same content rendered as Markdown (formulas as $$…$$) — used for export. */
  markdown: z.string(),
  generatedAt: Timestamp,
});
export type LectureNotes = z.infer<typeof LectureNotes>;

/** GET /api/sessions/:id/notes — always 200; poll or wait for the `notes.status` WS event. */
export const NotesResponse = z.object({
  status: ProcessingStatus,
  notes: LectureNotes.nullable(),
  error: z.string().nullable(),
});
export type NotesResponse = z.infer<typeof NotesResponse>;
