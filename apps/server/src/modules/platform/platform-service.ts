import type { ContextState, CreateSessionInput, IngestContextInput, IngestContextResult, KnowledgeEngine, NotesEngine, NotesResponse, SlideDeck, UpdateSessionInput } from "@sightline/contracts";
import { AppError, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";
import type { SessionEvents, SessionLifecycle } from "../../shared/ports";
import type { ObjectStorage } from "../../lib/storage";
import type { AssetStore } from "./assets/asset-store";
import type { JobChange, JobRepository, PlatformJob } from "./jobs/types";
import { deriveAwayWindows } from "./notes/away-windows";
import { exportNotes } from "./notes/export-notes";
import type { SlideProcessor } from "./slides/slide-processor";
import type { SessionStore } from "./store/types";

export type PlatformDeps = {
  store: SessionStore; knowledge: KnowledgeEngine & { ingestContext(input: IngestContextInput, publish?: (work: () => Promise<void>) => Promise<boolean>): Promise<IngestContextResult> }; notes: NotesEngine; slides: SlideProcessor;
  assets: AssetStore; events: SessionEvents; lifecycle: SessionLifecycle; jobs: JobRepository;
  storage?: ObjectStorage; recordingCleanupDelayMs?: number;
};

export class PlatformService {
  constructor(private readonly deps: PlatformDeps) {}

  async requireSession(userId: string, sessionId: string) {
    const session = await this.deps.store.getSession(userId, sessionId);
    if (!session) throw notFound("Session");
    return session;
  }
  async createSession(userId: string, input: CreateSessionInput) {
    const session = await this.deps.store.createSession(userId, {
      id: newId("ses"), title: input.title, subject: input.subject ?? null, mode: input.mode,
      status: "DRAFT", contextStatus: "EMPTY", slidesStatus: "EMPTY", notesStatus: "EMPTY",
      createdAt: Date.now(), startedAt: null, endedAt: null,
    });
    if (input.contextText) await this.setContextText(userId, session.id, input.contextText);
    return this.requireSession(userId, session.id);
  }
  async listSessions(userId: string, page: number, pageSize: number) {
    const { items, total } = await this.deps.store.listSessions(userId, page, pageSize);
    return { data: items, pagination: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) } };
  }
  async updateSession(userId: string, sessionId: string, patch: UpdateSessionInput) {
    await this.requireSession(userId, sessionId);
    return this.deps.store.updateSession(sessionId, patch);
  }
  async deleteSession(userId: string, sessionId: string) {
    if (!(await this.deps.store.getSession(userId, sessionId))) return;
    await this.deps.lifecycle.onSessionDeleted(sessionId);
    await this.deps.jobs.deleteSession(sessionId, this.deps.recordingCleanupDelayMs);
  }
  async startSession(userId: string, sessionId: string) {
    const session = await this.requireSession(userId, sessionId);
    if (session.status === "ENDED") throw new AppError("CONFLICT", "Session already ended");
    const updated = session.status === "LIVE" ? session : await this.deps.store.updateSession(sessionId, { status: "LIVE", startedAt: Date.now() });
    await this.deps.lifecycle.onSessionStarted(updated);
    this.deps.events.publish(sessionId, { type: "session.status", status: "LIVE", ts: Date.now() });
    return updated;
  }
  async endSession(userId: string, sessionId: string) {
    const session = await this.requireSession(userId, sessionId);
    if (session.status === "ENDED") return session;
    if (session.status !== "LIVE") throw new AppError("CONFLICT", "Only a LIVE session can be ended");
    await this.deps.lifecycle.onSessionEnded(sessionId);
    await this.deps.jobs.enqueue(sessionId, "NOTES", {}, { session: { status: "ENDED", endedAt: Date.now(), notesStatus: "PROCESSING" }, notesError: null });
    this.deps.events.publish(sessionId, { type: "session.status", status: "ENDED", ts: Date.now() });
    this.notesEvent(sessionId, "PROCESSING", null);
    return this.requireSession(userId, sessionId);
  }
  async getContext(userId: string, sessionId: string) {
    await this.requireSession(userId, sessionId);
    return this.deps.store.getContext(sessionId);
  }
  async setContextText(userId: string, sessionId: string, text: string) {
    await this.requireSession(userId, sessionId);
    const current = await this.deps.store.getContext(sessionId);
    await this.deps.jobs.enqueue(sessionId, "CONTEXT", {}, { context: { ...current, text, updatedAt: Date.now() } });
    return this.deps.store.getContext(sessionId);
  }
  async uploadSlides(userId: string, sessionId: string, file: File) {
    await this.requireSession(userId, sessionId);
    const assetId = await this.deps.assets.put(file.type || "application/octet-stream", new Uint8Array(await file.arrayBuffer()), sessionId);
    const deck: SlideDeck = { id: newId("dck"), sessionId, fileName: file.name, status: "PROCESSING", pageCount: 0, slides: [], error: null, uploadedAt: Date.now() };
    await this.deps.jobs.enqueue(sessionId, "SLIDES", { assetId, fileName: file.name }, { deck, session: { slidesStatus: "PROCESSING" } });
    return deck;
  }
  async getSlides(userId: string, sessionId: string) {
    await this.requireSession(userId, sessionId);
    const deck = await this.deps.store.getSlideDeck(sessionId);
    if (!deck) throw notFound("Slide deck");
    return deck;
  }
  async getNotes(userId: string, sessionId: string): Promise<NotesResponse> {
    const session = await this.requireSession(userId, sessionId);
    return { status: session.notesStatus, notes: await this.deps.store.getNotes(sessionId), error: await this.deps.store.getNotesError(sessionId) };
  }
  async regenerateNotes(userId: string, sessionId: string): Promise<NotesResponse> {
    const session = await this.requireSession(userId, sessionId);
    if (session.status !== "ENDED") throw new AppError("CONFLICT", "End the session before generating notes");
    await this.deps.jobs.enqueue(sessionId, "NOTES", {}, { session: { notesStatus: "PROCESSING" }, notesError: null });
    this.notesEvent(sessionId, "PROCESSING", null);
    return this.getNotes(userId, sessionId);
  }
  async exportNotesMarkdown(userId: string, sessionId: string) {
    await this.requireSession(userId, sessionId);
    const notes = await this.deps.store.getNotes(sessionId);
    if (!notes) throw notFound("Notes");
    return exportNotes(notes, await this.deps.store.listSnapshots(sessionId), this.deps.assets);
  }

  async executeJob(job: PlatformJob) {
    const { store, jobs, assets, knowledge } = this.deps;
    if (!(await jobs.isCurrent(job))) { await jobs.complete(job); return; }
    try {
      let change: JobChange;
      if (job.kind === "CLEANUP") {
        await knowledge.dropSession(job.sessionId);
        await assets.deleteSession(job.sessionId);
        const keys = job.payload.recordingKeys ?? [];
        if (keys.length && !this.deps.storage) throw new Error("Recording cleanup requires ObjectStorage");
        for (const key of keys) {
          if (!key.startsWith(`recordings/${job.sessionId}/`)) throw new AppError("VALIDATION_ERROR", "Recording cleanup key belongs to another session");
          await this.deps.storage!.deleteObject(key);
        }
        const after = job.payload.recordingCleanupAfter;
        await jobs.complete(job, after && after > Date.now() ? { next: { kind: "CLEANUP", payload: { recordingKeys: keys }, availableAt: after } } : {});
        return;
      }
      const session = await store.findSession(job.sessionId);
      if (!session) { await jobs.complete(job); return; }
      if (job.kind === "SLIDES") {
        const source = await assets.get(job.payload.assetId ?? "");
        if (!source) throw new AppError("VALIDATION_ERROR", "Uploaded source is missing");
        const slides = await this.deps.slides.process({ sessionId: job.sessionId, fileName: job.payload.fileName ?? "", bytes: source.bytes });
        const deck = await store.getSlideDeck(job.sessionId);
        if (!deck) throw notFound("Slide deck");
        change = { deck: { ...deck, status: "READY", slides, pageCount: slides.length, error: null }, session: { slidesStatus: "READY" }, next: { kind: "CONTEXT" } };
      } else if (job.kind === "CONTEXT") {
        const context = await store.getContext(job.sessionId);
        const deck = await store.getSlideDeck(job.sessionId);
        const slides = deck?.status === "READY" ? deck.slides : [];
        const source: ContextState["source"] = context.text && slides.length ? "TEXT_AND_SLIDES" : slides.length ? "SLIDES" : context.text ? "TEXT" : "NONE";
        const result = await knowledge.ingestContext({ sessionId: job.sessionId, title: session.title, subject: session.subject, text: context.text, slides }, (work) => jobs.publish(job, work));
        change = { context: { ...context, source, status: "READY", glossary: result.glossary, topics: result.topics, chunkCount: result.chunkCount, error: null, updatedAt: Date.now() }, session: { contextStatus: "READY" } };
      } else {
        const transcript = await store.listSegments(job.sessionId);
        const draft = await this.deps.notes.generateNotes({ session, context: await store.getContext(job.sessionId), slides: (await store.getSlideDeck(job.sessionId))?.slides ?? [], transcript, snapshots: await store.listSnapshots(job.sessionId),
          awayWindows: deriveAwayWindows(await store.listGazeTransitions(job.sessionId), transcript, session.startedAt ?? session.createdAt, session.endedAt ?? Date.now()) });
        change = { notes: { ...draft, id: newId("nts"), sessionId: job.sessionId, generatedAt: Date.now() }, session: { notesStatus: "READY" }, notesError: null };
      }
      if (await jobs.complete(job, change)) {
        if (job.kind === "NOTES") this.notesEvent(job.sessionId, "READY", change.notes!.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[platform] ${job.kind} ${job.id} attempt ${job.attempts} failed: ${message}`);
      const terminal = error instanceof AppError && error.code === "VALIDATION_ERROR";
      const change: JobChange = {};
      if (job.kind === "NOTES") Object.assign(change, { session: { notesStatus: "FAILED" }, notesError: message });
      if (job.kind === "CONTEXT" && await store.findSession(job.sessionId)) Object.assign(change, { session: { contextStatus: "FAILED" }, context: { ...await store.getContext(job.sessionId), status: "FAILED", error: message } });
      if (job.kind === "SLIDES") {
        const deck = await store.getSlideDeck(job.sessionId).catch(() => null);
        if (deck) Object.assign(change, { session: { slidesStatus: "FAILED" }, deck: { ...deck, status: "FAILED", error: message } });
      }
      await jobs.fail(job, message, !terminal, change);
      if (job.kind === "NOTES" && (terminal || job.attempts >= 3) && await store.findSession(job.sessionId)) this.notesEvent(job.sessionId, "FAILED", null);
    }
  }

  private notesEvent(sessionId: string, status: "PROCESSING" | "READY" | "FAILED", notesId: string | null) {
    this.deps.events.publish(sessionId, { type: "notes.status", status, notesId, ts: Date.now() });
  }
}
