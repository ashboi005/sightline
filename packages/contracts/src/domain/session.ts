import { z } from "zod";

import { SessionId, Timestamp } from "./common";

/** HARD_OF_HEARING = gaze-directed audio focus. DEAF = gaze-paused visual captions. Switchable live. */
export const AccessibilityMode = z.enum(["HARD_OF_HEARING", "DEAF"]);
export type AccessibilityMode = z.infer<typeof AccessibilityMode>;

/** DRAFT (setup) → LIVE (lecture running) → ENDED (notes can be generated). */
export const SessionStatus = z.enum(["DRAFT", "LIVE", "ENDED"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** Shared by context ingestion, slide processing and notes generation. */
export const ProcessingStatus = z.enum(["EMPTY", "PROCESSING", "READY", "FAILED"]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

export const Session = z.object({
  id: SessionId,
  title: z.string(),
  subject: z.string().nullable(),
  mode: AccessibilityMode,
  status: SessionStatus,
  contextStatus: ProcessingStatus,
  slidesStatus: ProcessingStatus,
  notesStatus: ProcessingStatus,
  createdAt: Timestamp,
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
});
export type Session = z.infer<typeof Session>;

export const CreateSessionInput = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().max(200).optional(),
  mode: AccessibilityMode.default("DEAF"),
  /** Shortcut for Option B (no slides): same as calling PUT /context/text afterwards. */
  contextText: z.string().max(20_000).optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

export const UpdateSessionInput = z
  .object({
    title: z.string().min(1).max(200),
    subject: z.string().max(200).nullable(),
    mode: AccessibilityMode,
  })
  .partial();
export type UpdateSessionInput = z.infer<typeof UpdateSessionInput>;

export const CurrentUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isMock: z.boolean(),
});
export type CurrentUser = z.infer<typeof CurrentUser>;

export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
  mocks: z.object({
    intelligence: z.boolean(),
    speech: z.boolean(),
    persistence: z.boolean(),
    slides: z.boolean(),
    auth: z.boolean(),
  }),
  ts: Timestamp,
});
export type HealthResponse = z.infer<typeof HealthResponse>;
