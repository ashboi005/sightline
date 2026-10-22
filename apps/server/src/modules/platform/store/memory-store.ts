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

import { notFound } from "../../../lib/errors";
import type { SessionStore } from "./types";

type Row = {
  userId: string;
  session: Session;
  context: ContextState;
  deck: SlideDeck | null;
  segments: Map<string, CaptionSegment>;
  gaze: GazeTransition[];
  utterances: SignUtterance[];
  snapshots: Map<string, Snapshot>;
  notes: LectureNotes | null;
};

export const emptyContext = (sessionId: string): ContextState => ({
  sessionId,
  status: "EMPTY",
  source: "NONE",
  text: null,
  topics: [],
  glossary: [],
  chunkCount: 0,
  error: null,
  updatedAt: Date.now(),
});

/** In-process store for mock mode. Data is lost on restart (the demo session is re-seeded). */
export class MemoryStore implements SessionStore {
  readonly name = "memory";
  private readonly rows = new Map<string, Row>();

  private row(sessionId: string): Row {
    const row = this.rows.get(sessionId);
    if (!row) throw notFound("Session");
    return row;
  }

  async createSession(userId: string, session: Session) {
    this.rows.set(session.id, {
      userId,
      session,
      context: emptyContext(session.id),
      deck: null,
      segments: new Map(),
      gaze: [],
      utterances: [],
      snapshots: new Map(),
      notes: null,
    });
    return session;
  }

  async listSessions(userId: string, page: number, pageSize: number) {
    const all = [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .map((r) => r.session)
      .sort((a, b) => b.createdAt - a.createdAt);
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  }

  async getSession(userId: string, sessionId: string) {
    const row = this.rows.get(sessionId);
    return row && row.userId === userId ? row.session : null;
  }

  async findSession(sessionId: string) {
    return this.rows.get(sessionId)?.session ?? null;
  }

  async updateSession(sessionId: string, patch: Partial<Omit<Session, "id">>) {
    const row = this.row(sessionId);
    row.session = { ...row.session, ...patch };
    return row.session;
  }

  async deleteSession(sessionId: string) {
    this.rows.delete(sessionId);
  }

  async getContext(sessionId: string) {
    return this.row(sessionId).context;
  }

  async saveContext(context: ContextState) {
    this.row(context.sessionId).context = context;
  }

  async getSlideDeck(sessionId: string) {
    return this.row(sessionId).deck;
  }

  async saveSlideDeck(deck: SlideDeck) {
    this.row(deck.sessionId).deck = deck;
  }

  async upsertSegment(segment: CaptionSegment) {
    this.row(segment.sessionId).segments.set(segment.id, segment);
  }

  async listSegments(sessionId: string) {
    return [...this.row(sessionId).segments.values()].sort((a, b) => a.seq - b.seq);
  }

  async addGazeTransition(sessionId: string, transition: GazeTransition) {
    this.row(sessionId).gaze.push(transition);
  }

  async listGazeTransitions(sessionId: string) {
    return this.row(sessionId).gaze;
  }

  async addUtterance(utterance: SignUtterance) {
    this.row(utterance.sessionId).utterances.push(utterance);
  }

  async listUtterances(sessionId: string) {
    return this.row(sessionId).utterances;
  }

  async upsertSnapshot(snapshot: Snapshot) {
    this.row(snapshot.sessionId).snapshots.set(snapshot.id, snapshot);
  }

  async listSnapshots(sessionId: string) {
    return [...this.row(sessionId).snapshots.values()].sort((a, b) => a.capturedAt - b.capturedAt);
  }

  async getNotes(sessionId: string) {
    return this.row(sessionId).notes;
  }

  async saveNotes(notes: LectureNotes) {
    this.row(notes.sessionId).notes = notes;
  }
}
