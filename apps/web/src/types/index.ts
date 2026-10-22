// Shapes returned by the Sightline server (apps/server). Timestamps are Unix epoch milliseconds.

export type User = {
  id: string;
  name: string;
  email: string;
};

export type AccessibilityMode = "HARD_OF_HEARING" | "DEAF";
export type SessionStatus = "DRAFT" | "LIVE" | "ENDED";
export type ProcessingStatus = "EMPTY" | "PROCESSING" | "READY" | "FAILED";

/** One lecture. */
export type Session = {
  id: string;
  title: string;
  subject: string | null;
  mode: AccessibilityMode;
  status: SessionStatus;
  contextStatus: ProcessingStatus;
  slidesStatus: ProcessingStatus;
  notesStatus: ProcessingStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
};

export type Paginated<T> = {
  data: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};
