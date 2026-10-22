/**
 * OWNER: Tushar — Postgres implementation of SessionStore using the Drizzle tables in
 * packages/db/src/schema/sightline.ts. Until it is done, run with MOCK_PERSISTENCE=true.
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
import type { Database } from "@sightline/db";

import { notImplemented } from "../../../lib/errors";
import type { SessionStore } from "./types";

const todo = (method: string) => notImplemented(`PostgresStore.${method}`, "Tushar");

export class PostgresStore implements SessionStore {
  readonly name = "postgres";

  constructor(readonly db: Database) {}

  async createSession(_userId: string, _session: Session): Promise<Session> {
    throw todo("createSession");
  }
  async listSessions(_userId: string, _page: number, _pageSize: number): Promise<{ items: Session[]; total: number }> {
    throw todo("listSessions");
  }
  async getSession(_userId: string, _sessionId: string): Promise<Session | null> {
    throw todo("getSession");
  }
  async findSession(_sessionId: string): Promise<Session | null> {
    throw todo("findSession");
  }
  async updateSession(_sessionId: string, _patch: Partial<Omit<Session, "id">>): Promise<Session> {
    throw todo("updateSession");
  }
  async deleteSession(_sessionId: string): Promise<void> {
    throw todo("deleteSession");
  }
  async getContext(_sessionId: string): Promise<ContextState> {
    throw todo("getContext");
  }
  async saveContext(_context: ContextState): Promise<void> {
    throw todo("saveContext");
  }
  async getSlideDeck(_sessionId: string): Promise<SlideDeck | null> {
    throw todo("getSlideDeck");
  }
  async saveSlideDeck(_deck: SlideDeck): Promise<void> {
    throw todo("saveSlideDeck");
  }
  async upsertSegment(_segment: CaptionSegment): Promise<void> {
    throw todo("upsertSegment");
  }
  async listSegments(_sessionId: string): Promise<CaptionSegment[]> {
    throw todo("listSegments");
  }
  async addGazeTransition(_sessionId: string, _transition: GazeTransition): Promise<void> {
    throw todo("addGazeTransition");
  }
  async listGazeTransitions(_sessionId: string): Promise<GazeTransition[]> {
    throw todo("listGazeTransitions");
  }
  async addUtterance(_utterance: SignUtterance): Promise<void> {
    throw todo("addUtterance");
  }
  async listUtterances(_sessionId: string): Promise<SignUtterance[]> {
    throw todo("listUtterances");
  }
  async upsertSnapshot(_snapshot: Snapshot): Promise<void> {
    throw todo("upsertSnapshot");
  }
  async listSnapshots(_sessionId: string): Promise<Snapshot[]> {
    throw todo("listSnapshots");
  }
  async getNotes(_sessionId: string): Promise<LectureNotes | null> {
    throw todo("getNotes");
  }
  async saveNotes(_notes: LectureNotes): Promise<void> {
    throw todo("saveNotes");
  }
}
