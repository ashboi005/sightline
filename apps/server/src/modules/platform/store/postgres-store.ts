import type { CaptionSegment, ContextState, GazeTransition, LectureNotes, Session, Snapshot, SignUtterance, SlideDeck } from "@sightline/contracts";
import type { Database } from "@sightline/db";
import { user } from "@sightline/db/schema/auth";
import { captionSegment, gazeTransition, lectureContext, lectureNotes, lectureSession, signUtterance, slideDeck } from "@sightline/db/schema/sightline";
import { and, count, desc, eq, sql } from "drizzle-orm";

import { notImplemented, notFound } from "../../../lib/errors";
import { emptyContext } from "./memory-store";
import type { SessionStore } from "./types";

export const toSession = (row: typeof lectureSession.$inferSelect): Session => ({
  id: row.id, title: row.title, subject: row.subject, mode: row.mode, status: row.status,
  contextStatus: row.contextStatus as Session["contextStatus"], slidesStatus: row.slidesStatus as Session["slidesStatus"],
  notesStatus: row.notesStatus as Session["notesStatus"], createdAt: row.createdAt, startedAt: row.startedAt, endedAt: row.endedAt,
});

export class PostgresStore implements SessionStore {
  readonly name = "postgres";
  constructor(readonly db: Database) {}

  async provisionDemoUser() {
    await this.db.insert(user).values({ id: "usr_demo", name: "Demo Student", email: "demo@sightline.dev" }).onConflictDoNothing();
  }
  async createSession(userId: string, session: Session) {
    await this.db.transaction(async (transaction) => {
      await transaction.insert(lectureSession).values({ ...session, userId });
      await transaction.insert(lectureContext).values(emptyContext(session.id));
    });
    return session;
  }
  async listSessions(userId: string, page: number, pageSize: number) {
    const predicate = eq(lectureSession.userId, userId);
    const [items, totals] = await Promise.all([
      this.db.select().from(lectureSession).where(predicate).orderBy(desc(lectureSession.createdAt), desc(lectureSession.id)).limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(lectureSession).where(predicate),
    ]);
    return { items: items.map(toSession), total: totals[0]?.total ?? 0 };
  }
  async getSession(userId: string, sessionId: string) {
    const [row] = await this.db.select().from(lectureSession).where(and(eq(lectureSession.id, sessionId), eq(lectureSession.userId, userId)));
    return row ? toSession(row) : null;
  }
  async findSession(sessionId: string) {
    const [row] = await this.db.select().from(lectureSession).where(eq(lectureSession.id, sessionId));
    return row ? toSession(row) : null;
  }
  async updateSession(sessionId: string, patch: Partial<Omit<Session, "id">>) {
    const [row] = await this.db.update(lectureSession).set(patch).where(eq(lectureSession.id, sessionId)).returning();
    if (!row) throw notFound("Session");
    return toSession(row);
  }
  async deleteSession(sessionId: string) {
    await this.db.delete(lectureSession).where(eq(lectureSession.id, sessionId));
  }
  async getContext(sessionId: string): Promise<ContextState> {
    const [row] = await this.db.select().from(lectureContext).where(eq(lectureContext.sessionId, sessionId));
    if (!row) throw notFound("Session context");
    return { ...row, status: row.status as ContextState["status"], source: row.source as ContextState["source"] };
  }
  async saveContext(context: ContextState) {
    await this.db.insert(lectureContext).values(context).onConflictDoUpdate({ target: lectureContext.sessionId, set: context });
  }
  async getSlideDeck(sessionId: string): Promise<SlideDeck | null> {
    const [row] = await this.db.select().from(slideDeck).where(eq(slideDeck.sessionId, sessionId));
    return row ? { ...row, status: row.status as SlideDeck["status"] } : null;
  }
  async saveSlideDeck(deck: SlideDeck) {
    await this.db.insert(slideDeck).values(deck).onConflictDoUpdate({ target: slideDeck.sessionId, set: deck });
  }
  async upsertSegment(segment: CaptionSegment) {
    await this.db.insert(captionSegment).values(segment).onConflictDoUpdate({
      target: captionSegment.id, set: segment,
      setWhere: and(eq(captionSegment.sessionId, segment.sessionId), sql`case ${captionSegment.status} when 'REFINED' then 2 when 'FINAL' then 1 else 0 end <= ${segment.status === "REFINED" ? 2 : segment.status === "FINAL" ? 1 : 0}`),
    });
  }
  async listSegments(sessionId: string) {
    return this.db.select().from(captionSegment).where(eq(captionSegment.sessionId, sessionId)).orderBy(captionSegment.seq, captionSegment.id);
  }
  async addGazeTransition(sessionId: string, transition: GazeTransition) {
    await this.db.insert(gazeTransition).values({ sessionId, fromZone: transition.from, toZone: transition.to, targetId: transition.targetId, ts: transition.ts });
  }
  async listGazeTransitions(sessionId: string): Promise<GazeTransition[]> {
    const rows = await this.db.select().from(gazeTransition).where(eq(gazeTransition.sessionId, sessionId)).orderBy(gazeTransition.ts, gazeTransition.id);
    return rows.map((row) => ({ from: row.fromZone as GazeTransition["from"], to: row.toZone as GazeTransition["to"], targetId: row.targetId, ts: row.ts }));
  }
  async addUtterance(utterance: SignUtterance) {
    await this.db.insert(signUtterance).values(utterance).onConflictDoNothing();
  }
  async listUtterances(sessionId: string) {
    return this.db.select().from(signUtterance).where(eq(signUtterance.sessionId, sessionId)).orderBy(signUtterance.createdAt, signUtterance.id);
  }
  async upsertSnapshot(_snapshot: Snapshot): Promise<void> {
    throw notImplemented("PostgresStore.upsertSnapshot", "Tushar");
  }
  async listSnapshots(_sessionId: string): Promise<Snapshot[]> {
    throw notImplemented("PostgresStore.listSnapshots", "Tushar");
  }
  async getNotes(sessionId: string): Promise<LectureNotes | null> {
    const [row] = await this.db.select().from(lectureNotes).where(eq(lectureNotes.sessionId, sessionId));
    return row ? { ...row.content, id: row.id, sessionId: row.sessionId, generatedAt: row.generatedAt } : null;
  }
  async saveNotes(notes: LectureNotes) {
    const { id, sessionId, generatedAt, ...content } = notes;
    const row = { id, sessionId, generatedAt, content };
    await this.db.insert(lectureNotes).values(row).onConflictDoUpdate({ target: lectureNotes.sessionId, set: row });
  }
  async listReadyContexts(): Promise<ContextState[]> {
    const rows = await this.db.select().from(lectureContext);
    return rows.map((row) => ({ ...row, status: row.status as ContextState["status"], source: row.source as ContextState["source"] }));
  }
  async getNotesError(sessionId: string) {
    const [row] = await this.db.select({ error: lectureSession.notesError }).from(lectureSession).where(eq(lectureSession.id, sessionId));
    return row?.error ?? null;
  }
  async setNotesError(sessionId: string, error: string | null) {
    await this.db.update(lectureSession).set({ notesError: error }).where(eq(lectureSession.id, sessionId));
  }
}
