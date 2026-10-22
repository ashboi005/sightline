/**
 * OWNER: Tushar. Persistence port. MOCK_PERSISTENCE=true → MemoryStore, otherwise PostgresStore (Drizzle).
 */
import type {
  CaptionSegment,
  ContextState,
  GazeTransition,
  LectureNotes,
  Session,
  SignUtterance,
  SlideDeck,
  Snapshot,
} from "@sightline/contracts";

export interface SessionStore {
  readonly name: string;

  listReadyContexts(): Promise<ContextState[]>;
  getNotesError(sessionId: string): Promise<string | null>;
  setNotesError(sessionId: string, error: string | null): Promise<void>;

  createSession(userId: string, session: Session): Promise<Session>;
  listSessions(userId: string, page: number, pageSize: number): Promise<{ items: Session[]; total: number }>;
  /** Returns null when missing OR owned by another user. */
  getSession(userId: string, sessionId: string): Promise<Session | null>;
  /** Internal lookup without the ownership check (background jobs, sockets after auth). */
  findSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, patch: Partial<Omit<Session, "id">>): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;

  getContext(sessionId: string): Promise<ContextState>;
  saveContext(context: ContextState): Promise<void>;

  getSlideDeck(sessionId: string): Promise<SlideDeck | null>;
  saveSlideDeck(deck: SlideDeck): Promise<void>;

  /** Insert or replace by segment id. */
  upsertSegment(segment: CaptionSegment): Promise<void>;
  listSegments(sessionId: string): Promise<CaptionSegment[]>;

  addGazeTransition(sessionId: string, transition: GazeTransition): Promise<void>;
  listGazeTransitions(sessionId: string): Promise<GazeTransition[]>;

  addUtterance(utterance: SignUtterance): Promise<void>;
  listUtterances(sessionId: string): Promise<SignUtterance[]>;

  /** Board/diagram snapshots (written by Ashwath's live module, read by the notes job). Insert or replace by id. */
  upsertSnapshot(snapshot: Snapshot): Promise<void>;
  listSnapshots(sessionId: string): Promise<Snapshot[]>;

  getNotes(sessionId: string): Promise<LectureNotes | null>;
  saveNotes(notes: LectureNotes): Promise<void>;
}
