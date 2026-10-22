/**
 * OWNER: Tushar. Starting-point tables for PostgresStore (apps/server/src/modules/platform/store).
 * Rich nested shapes (caption parts, glossary, notes) are stored as jsonb typed with the contract types.
 * Named `lecture_session` to avoid clashing with better-auth's `session` table.
 */
import type {
  CaptionCorrection,
  CaptionPart,
  GlossaryTerm,
  LectureNotes,
  Slide,
  SlidePointer,
  RecordingSegment,
  SnapshotTrigger,
} from "@sightline/contracts";
import { bigint, index, integer, jsonb, pgTable, real, text } from "drizzle-orm/pg-core";

import { user } from "./auth";

const epochMs = (name: string) => bigint(name, { mode: "number" });

export const lectureSession = pgTable(
  "lecture_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subject: text("subject"),
    mode: text("mode", { enum: ["HARD_OF_HEARING", "DEAF"] }).notNull(),
    status: text("status", { enum: ["DRAFT", "LIVE", "ENDED"] }).notNull(),
    contextStatus: text("context_status").notNull().default("EMPTY"),
    slidesStatus: text("slides_status").notNull().default("EMPTY"),
    notesStatus: text("notes_status").notNull().default("EMPTY"),
    createdAt: epochMs("created_at").notNull(),
    startedAt: epochMs("started_at"),
    endedAt: epochMs("ended_at"),
  },
  (t) => [index("lecture_session_user_idx").on(t.userId, t.createdAt)],
);

export const lectureContext = pgTable("lecture_context", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => lectureSession.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  source: text("source").notNull(),
  text: text("text"),
  topics: jsonb("topics").$type<string[]>().notNull().default([]),
  glossary: jsonb("glossary").$type<GlossaryTerm[]>().notNull().default([]),
  chunkCount: integer("chunk_count").notNull().default(0),
  error: text("error"),
  updatedAt: epochMs("updated_at").notNull(),
});

export const slideDeck = pgTable("slide_deck", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => lectureSession.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  status: text("status").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  slides: jsonb("slides").$type<Slide[]>().notNull().default([]),
  error: text("error"),
  uploadedAt: epochMs("uploaded_at").notNull(),
});

export const captionSegment = pgTable(
  "caption_segment",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => lectureSession.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    status: text("status", { enum: ["INTERIM", "FINAL", "REFINED"] }).notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speaker: text("speaker"),
    rawText: text("raw_text").notNull(),
    text: text("text").notNull(),
    parts: jsonb("parts").$type<CaptionPart[]>().notNull(),
    corrections: jsonb("corrections").$type<CaptionCorrection[]>().notNull().default([]),
    slidePointer: jsonb("slide_pointer").$type<SlidePointer | null>(),
    confidence: real("confidence").notNull(),
  },
  (t) => [index("caption_segment_session_seq_idx").on(t.sessionId, t.seq)],
);

export const gazeTransition = pgTable(
  "gaze_transition",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    sessionId: text("session_id")
      .notNull()
      .references(() => lectureSession.id, { onDelete: "cascade" }),
    fromZone: text("from_zone").notNull(),
    toZone: text("to_zone").notNull(),
    targetId: text("target_id"),
    ts: epochMs("ts").notNull(),
  },
  (t) => [index("gaze_transition_session_idx").on(t.sessionId, t.ts)],
);

export const signUtterance = pgTable("sign_utterance", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => lectureSession.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["SELF", "PEER"] }).notNull(),
  gloss: jsonb("gloss").$type<string[]>().notNull(),
  text: text("text").notNull(),
  alternatives: jsonb("alternatives").$type<string[]>().notNull().default([]),
  audioUrl: text("audio_url"),
  confidence: real("confidence").notNull(),
  createdAt: epochMs("created_at").notNull(),
});

export const lectureNotes = pgTable("lecture_notes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => lectureSession.id, { onDelete: "cascade" }),
  /** The full LectureNotes object (minus ids) — notes are always read/written whole. */
  content: jsonb("content").$type<Omit<LectureNotes, "id" | "sessionId" | "generatedAt">>().notNull(),
  generatedAt: epochMs("generated_at").notNull(),
});

/** Board/diagram snapshots (rows written by Ashwath's live module; the image itself is an asset). */
export const snapshot = pgTable(
  "snapshot",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => lectureSession.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    trigger: text("trigger").$type<SnapshotTrigger>().notNull(),
    reason: text("reason").notNull(),
    capturedAt: epochMs("captured_at").notNull(),
    atMs: integer("at_ms").notNull(),
    segmentIds: jsonb("segment_ids").$type<string[]>().notNull().default([]),
    description: text("description"),
  },
  (t) => [index("snapshot_session_idx").on(t.sessionId, t.capturedAt)],
);

/** Session recordings; segments are objects in storage at recordings/<session>/<recording>/segment-NNNN.<ext>. */
export const recording = pgTable(
  "recording",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => lectureSession.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    status: text("status").notNull(),
    startedAt: epochMs("started_at").notNull(),
    endedAt: epochMs("ended_at"),
    durationMs: integer("duration_ms").notNull().default(0),
    /** Without `url` — presigned on read. */
    segments: jsonb("segments").$type<Omit<RecordingSegment, "url">[]>().notNull().default([]),
  },
  (t) => [index("recording_session_idx").on(t.sessionId, t.startedAt)],
);
