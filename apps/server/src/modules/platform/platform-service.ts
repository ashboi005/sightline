/**
 * OWNER: Tushar. Business logic behind the REST routes and the session socket.
 * Routes stay thin; everything that touches the store, STT/TTS or the IntelligenceEngine lives here.
 */
import type {
  ContextSource,
  ContextState,
  CreateSessionInput,
  CreateSignUtteranceInput,
  IntelligenceEngine,
  LectureNotes,
  NotesResponse,
  ProcessingStatus,
  Session,
  SignUtterance,
  SlideDeck,
  UpdateSessionInput,
} from "@sightline/contracts";

import { AppError, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";
import type { AssetStore } from "./assets/asset-store";
import { deriveAwayWindows } from "./notes/away-windows";
import type { SessionHub } from "./realtime/hub";
import type { LiveCaptions } from "./realtime/live-captions";
import type { SlideProcessor } from "./slides/slide-processor";
import type { TextToSpeech } from "./speech/types";
import type { SessionStore } from "./store/types";

export type PlatformDeps = {
  store: SessionStore;
  intelligence: IntelligenceEngine;
  tts: TextToSpeech;
  slides: SlideProcessor;
  assets: AssetStore;
  hub: SessionHub;
  live: LiveCaptions;
  assetUrl: (assetId: string) => string;
};

/** Fire-and-forget background work with logging (jobs report progress through the store + hub). */
const background = (label: string, work: () => Promise<unknown>) => {
  work().catch((error) => console.error(`[platform] ${label} failed`, error));
};

export class PlatformService {
  constructor(private readonly deps: PlatformDeps) {}

  // --- sessions ------------------------------------------------------------

  async requireSession(userId: string, sessionId: string): Promise<Session> {
    const session = await this.deps.store.getSession(userId, sessionId);
    if (!session) throw notFound("Session");
    return session;
  }

  async createSession(userId: string, input: CreateSessionInput): Promise<Session> {
    const session = await this.deps.store.createSession(userId, {
      id: newId("ses"),
      title: input.title,
      subject: input.subject ?? null,
      mode: input.mode,
      status: "DRAFT",
      contextStatus: "EMPTY",
      slidesStatus: "EMPTY",
      notesStatus: "EMPTY",
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
    });
    if (input.contextText) {
      await this.setContextText(userId, session.id, input.contextText);
      return this.requireSession(userId, session.id);
    }
    return session;
  }

  async listSessions(userId: string, page: number, pageSize: number) {
    const { items, total } = await this.deps.store.listSessions(userId, page, pageSize);
    return { data: items, pagination: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) } };
  }

  async updateSession(userId: string, sessionId: string, patch: UpdateSessionInput): Promise<Session> {
    await this.requireSession(userId, sessionId);
    return this.deps.store.updateSession(sessionId, patch);
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.deps.store.getSession(userId, sessionId);
    if (!session) return; // idempotent
    await this.deps.live.stop(sessionId);
    await this.deps.intelligence.dropSession(sessionId).catch(() => {});
    await this.deps.store.deleteSession(sessionId);
  }

  async startSession(userId: string, sessionId: string): Promise<Session> {
    const session = await this.requireSession(userId, sessionId);
    if (session.status === "ENDED") throw new AppError("CONFLICT", "Session already ended");
    const updated =
      session.status === "LIVE"
        ? session
        : await this.deps.store.updateSession(sessionId, { status: "LIVE", startedAt: Date.now() });
    this.deps.hub.publish(sessionId, { type: "session.status", status: "LIVE", ts: Date.now() });
    if (this.deps.live.isReplay) await this.deps.live.start(sessionId, updated.startedAt ?? Date.now());
    return updated;
  }

  async endSession(userId: string, sessionId: string): Promise<Session> {
    const session = await this.requireSession(userId, sessionId);
    if (session.status === "ENDED") return session;
    if (session.status !== "LIVE") throw new AppError("CONFLICT", "Only a LIVE session can be ended");
    await this.deps.live.stop(sessionId);
    const updated = await this.deps.store.updateSession(sessionId, { status: "ENDED", endedAt: Date.now() });
    this.deps.hub.publish(sessionId, { type: "session.status", status: "ENDED", ts: Date.now() });
    background("notes", () => this.generateNotes(sessionId));
    return { ...updated, notesStatus: "PROCESSING" };
  }

  // --- context & slides ----------------------------------------------------

  async getContext(userId: string, sessionId: string): Promise<ContextState> {
    await this.requireSession(userId, sessionId);
    return this.deps.store.getContext(sessionId);
  }

  async setContextText(userId: string, sessionId: string, text: string): Promise<ContextState> {
    await this.requireSession(userId, sessionId);
    const current = await this.deps.store.getContext(sessionId);
    await this.deps.store.saveContext({ ...current, text, updatedAt: Date.now() });
    return this.startIngest(sessionId);
  }

  async uploadSlides(userId: string, sessionId: string, file: File): Promise<SlideDeck> {
    await this.requireSession(userId, sessionId);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const deck: SlideDeck = {
      id: newId("dck"),
      sessionId,
      fileName: file.name,
      status: "PROCESSING",
      pageCount: 0,
      slides: [],
      error: null,
      uploadedAt: Date.now(),
    };
    await this.deps.store.saveSlideDeck(deck);
    await this.deps.store.updateSession(sessionId, { slidesStatus: "PROCESSING" });

    background("slides", async () => {
      try {
        await this.deps.assets.put(file.type || "application/octet-stream", bytes);
        const slides = await this.deps.slides.process({ sessionId, fileName: file.name, bytes });
        await this.deps.store.saveSlideDeck({ ...deck, status: "READY", slides, pageCount: slides.length });
        await this.deps.store.updateSession(sessionId, { slidesStatus: "READY" });
        await this.startIngest(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.deps.store.saveSlideDeck({ ...deck, status: "FAILED", error: message });
        await this.deps.store.updateSession(sessionId, { slidesStatus: "FAILED" });
      }
    });
    return deck;
  }

  async getSlides(userId: string, sessionId: string): Promise<SlideDeck> {
    await this.requireSession(userId, sessionId);
    const deck = await this.deps.store.getSlideDeck(sessionId);
    if (!deck) throw notFound("Slide deck");
    return deck;
  }

  /** Marks context PROCESSING, returns immediately, ingests in the background. */
  private async startIngest(sessionId: string): Promise<ContextState> {
    const { store, intelligence } = this.deps;
    const current = await store.getContext(sessionId);
    const deck = await store.getSlideDeck(sessionId);
    const hasSlides = deck?.status === "READY" && deck.slides.length > 0;
    const source: ContextSource =
      current.text && hasSlides ? "TEXT_AND_SLIDES" : hasSlides ? "SLIDES" : current.text ? "TEXT" : "NONE";

    const processing: ContextState = { ...current, status: "PROCESSING", source, error: null, updatedAt: Date.now() };
    await store.saveContext(processing);
    await this.setStatus(sessionId, "contextStatus", "PROCESSING");

    background("ingest", async () => {
      const session = await store.findSession(sessionId);
      if (!session) return;
      try {
        const result = await intelligence.ingestContext({
          sessionId,
          title: session.title,
          subject: session.subject,
          text: processing.text,
          slides: hasSlides ? deck.slides.map(({ index, title, text, bullets }) => ({ index, title, text, bullets })) : [],
        });
        await store.saveContext({
          ...processing,
          status: "READY",
          glossary: result.glossary,
          topics: result.topics,
          chunkCount: result.chunkCount,
          updatedAt: Date.now(),
        });
        await this.setStatus(sessionId, "contextStatus", "READY");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.saveContext({ ...processing, status: "FAILED", error: message, updatedAt: Date.now() });
        await this.setStatus(sessionId, "contextStatus", "FAILED");
      }
    });
    return processing;
  }

  // --- live data -----------------------------------------------------------

  async getTranscript(userId: string, sessionId: string) {
    await this.requireSession(userId, sessionId);
    return { data: await this.deps.store.listSegments(sessionId) };
  }

  async createSignUtterance(userId: string, sessionId: string, input: CreateSignUtteranceInput): Promise<SignUtterance> {
    await this.requireSession(userId, sessionId);
    const { store, intelligence, tts, assets, hub } = this.deps;

    const recentCaptions = (await store.listSegments(sessionId)).slice(-5).map((s) => s.text);
    const composed = await intelligence.composeSignSentence({
      sessionId,
      tokens: input.tokens,
      source: input.source,
      recentCaptions,
    });

    let audioUrl: string | null = null;
    if (input.speak) {
      try {
        const audio = await tts.synthesize(composed.text);
        audioUrl = this.deps.assetUrl(await assets.put(audio.contentType, audio.bytes));
      } catch (error) {
        console.warn("[platform] TTS failed, returning text only", error);
      }
    }

    const utterance: SignUtterance = {
      id: newId("utt"),
      sessionId,
      source: input.source,
      gloss: input.tokens.map((t) => t.gloss),
      text: composed.text,
      alternatives: composed.alternatives,
      audioUrl,
      confidence: composed.confidence,
      createdAt: Date.now(),
    };
    await store.addUtterance(utterance);
    hub.publish(sessionId, { type: "sign.utterance", utterance, ts: Date.now() });
    return utterance;
  }

  async listSignUtterances(userId: string, sessionId: string) {
    await this.requireSession(userId, sessionId);
    return { data: await this.deps.store.listUtterances(sessionId) };
  }

  async recordGaze(sessionId: string, transition: Parameters<SessionStore["addGazeTransition"]>[1]) {
    await this.deps.store.addGazeTransition(sessionId, transition);
  }

  // --- notes ---------------------------------------------------------------

  async getNotes(userId: string, sessionId: string): Promise<NotesResponse> {
    const session = await this.requireSession(userId, sessionId);
    const notes = await this.deps.store.getNotes(sessionId);
    return { status: session.notesStatus, notes, error: null };
  }

  async regenerateNotes(userId: string, sessionId: string): Promise<NotesResponse> {
    const session = await this.requireSession(userId, sessionId);
    if (session.status !== "ENDED") throw new AppError("CONFLICT", "End the session before generating notes");
    background("notes", () => this.generateNotes(sessionId));
    return { status: "PROCESSING", notes: await this.deps.store.getNotes(sessionId), error: null };
  }

  async exportNotesMarkdown(userId: string, sessionId: string): Promise<string> {
    await this.requireSession(userId, sessionId);
    const notes = await this.deps.store.getNotes(sessionId);
    if (!notes) throw notFound("Notes");
    return notes.markdown;
  }

  /** Background job: gather everything about the session and ask the IntelligenceEngine for notes. */
  async generateNotes(sessionId: string): Promise<LectureNotes | null> {
    const { store, intelligence, hub } = this.deps;
    await this.setStatus(sessionId, "notesStatus", "PROCESSING");
    hub.publish(sessionId, { type: "notes.status", status: "PROCESSING", notesId: null, ts: Date.now() });
    try {
      const session = await store.findSession(sessionId);
      if (!session) throw notFound("Session");
      const transcript = await store.listSegments(sessionId);
      const startedAt = session.startedAt ?? session.createdAt;
      const draft = await intelligence.generateNotes({
        session,
        context: await store.getContext(sessionId),
        slides: (await store.getSlideDeck(sessionId))?.slides ?? [],
        transcript,
        awayWindows: deriveAwayWindows(
          await store.listGazeTransitions(sessionId),
          transcript,
          startedAt,
          session.endedAt ?? Date.now(),
        ),
      });
      const notes: LectureNotes = { ...draft, id: newId("nts"), sessionId, generatedAt: Date.now() };
      await store.saveNotes(notes);
      await this.setStatus(sessionId, "notesStatus", "READY");
      hub.publish(sessionId, { type: "notes.status", status: "READY", notesId: notes.id, ts: Date.now() });
      return notes;
    } catch (error) {
      console.error("[platform] notes generation failed", error);
      await this.setStatus(sessionId, "notesStatus", "FAILED");
      hub.publish(sessionId, { type: "notes.status", status: "FAILED", notesId: null, ts: Date.now() });
      return null;
    }
  }

  private async setStatus(
    sessionId: string,
    field: "contextStatus" | "slidesStatus" | "notesStatus",
    status: ProcessingStatus,
  ) {
    await this.deps.store.updateSession(sessionId, { [field]: status });
  }
}
