import type { ContextState, LectureNotes, Session, SlideDeck } from "@sightline/contracts";

export type JobKind = "SLIDES" | "CONTEXT" | "NOTES" | "CLEANUP";
export type JobPayload = { assetId?: string; fileName?: string };
export type PlatformJob = {
  id: string;
  sessionId: string;
  kind: JobKind;
  payload: JobPayload;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  attempts: number;
  availableAt: number;
  leaseUntil: number | null;
  token: string | null;
  error: string | null;
  createdAt: number;
};
export type JobChange = {
  next?: { kind: JobKind; payload?: JobPayload };
  session?: Partial<Omit<Session, "id">>;
  context?: ContextState;
  deck?: SlideDeck;
  notes?: LectureNotes;
  notesError?: string | null;
};
export interface JobRepository {
  enqueue(sessionId: string, kind: JobKind, payload?: JobPayload, change?: JobChange): Promise<PlatformJob>;
  claim(now: number): Promise<PlatformJob | null>;
  renew(job: PlatformJob, now: number): Promise<boolean>;
  isCurrent(job: PlatformJob): Promise<boolean>;
  publish(job: PlatformJob, work: () => Promise<void>): Promise<boolean>;
  complete(job: PlatformJob, change?: JobChange): Promise<boolean>;
  fail(job: PlatformJob, error: string, retry: boolean, change?: JobChange): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
