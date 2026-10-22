/**
 * Composition root: picks real vs mock implementations from the MOCK_* flags (see config.ts).
 *
 *   core (Ashwath)        modules/live      — captions, speech, realtime socket, sign sentences
 *   surrounding (Tushar)  modules/platform  — sessions, store, slides, knowledge (RAG), notes, auth
 */
import type { HealthResponse, KnowledgeEngine, NotesEngine } from "@sightline/contracts";
import { QdrantClient } from "@qdrant/js-client-rest";

import { config } from "./config";
import { ENV } from "./env.server";
import { createLiveModule } from "./modules/live";
import { DeepgramStt } from "./modules/live/speech/deepgram-stt";
import { MockReplayStt } from "./modules/live/speech/mock-stt";
import { MockTts, ProviderTts } from "./modules/live/speech/tts";
import { DiskAssetStore, MemoryAssetStore } from "./modules/platform/assets/asset-store";
import { createUserResolver } from "./modules/platform/auth";
import { MockKnowledgeEngine } from "./modules/platform/knowledge/mock-knowledge-engine";
import { QdrantKnowledgeEngine } from "./modules/platform/knowledge/qdrant-knowledge-engine";
import { LlmNotesEngine } from "./modules/platform/notes/llm-notes-engine";
import { MockNotesEngine } from "./modules/platform/notes/mock-notes-engine";
import { PlatformService } from "./modules/platform/platform-service";
import { FileSlideProcessor, MockSlideProcessor } from "./modules/platform/slides/slide-processor";
import { MemoryStore } from "./modules/platform/store/memory-store";
import { PostgresStore } from "./modules/platform/store/postgres-store";
import { auth, db } from "./services";
import { MastraStructuredModel, OpenAIEmbeddings } from "./modules/platform/ai/structured-model";
import { MemoryJobs } from "./modules/platform/jobs/memory-jobs";
import { PostgresJobs } from "./modules/platform/jobs/postgres-jobs";
import { JobRunner } from "./modules/platform/jobs/runner";

export function createContainer() {
  const { mocks } = config;
  const assetUrl = (assetId: string) => `${config.publicUrl}/api/assets/${assetId}`;

  // --- surrounding (Tushar) ------------------------------------------------
  const store = mocks.persistence ? new MemoryStore() : new PostgresStore(db);
  const assets = mocks.persistence ? new MemoryAssetStore(store) : new DiskAssetStore(config.storageDir, db);
  const slides = mocks.slides ? new MockSlideProcessor(assets, assetUrl) : new FileSlideProcessor(assets, assetUrl);
  const model = new MastraStructuredModel(ENV.LLM_MODEL);
  const knowledge: KnowledgeEngine = mocks.knowledge
    ? new MockKnowledgeEngine()
    : new QdrantKnowledgeEngine({ client: new QdrantClient({ url: ENV.QDRANT_URL, apiKey: ENV.QDRANT_API_KEY || undefined, timeout: 30_000 }), embeddings: new OpenAIEmbeddings(ENV.OPENAI_API_KEY, ENV.EMBEDDING_MODEL), model, pointerThreshold: ENV.SLIDE_POINTER_THRESHOLD, pointerMargin: ENV.SLIDE_POINTER_MARGIN });
  const notes: NotesEngine = mocks.notes ? new MockNotesEngine() : new LlmNotesEngine(knowledge, model);
  const resolveUser = createUserResolver({ mock: mocks.auth, auth });

  // --- core (Ashwath) ------------------------------------------------------
  const stt = mocks.speech ? new MockReplayStt(config.mockReplaySpeed) : new DeepgramStt(ENV.DEEPGRAM_API_KEY, ENV.DEEPGRAM_MODEL);
  const tts = mocks.speech
    ? new MockTts()
    : new ProviderTts(
        ENV.TTS_PROVIDER,
        ENV.TTS_PROVIDER === "sarvam" ? ENV.SARVAM_API_KEY : ENV.ELEVENLABS_API_KEY,
        ENV.ELEVENLABS_VOICE_ID,
      );
  const live = createLiveModule({ mockCaptions: mocks.captions, stt, tts, store, assets, knowledge, resolveUser, assetUrl });

  // --- platform uses the live module only via lifecycle + events -----------
  const jobs = mocks.persistence ? new MemoryJobs(store) : new PostgresJobs(db);
  const platform = new PlatformService({ store, knowledge, notes, slides, assets, events: live.events, lifecycle: live.lifecycle, jobs });
  const runner = new JobRunner(jobs, (job) => platform.executeJob(job));
  const initialize = async () => {
    if (!mocks.knowledge && !ENV.OPENAI_API_KEY) throw new Error("Real knowledge requires OPENAI_API_KEY");
    if ((!mocks.knowledge || !mocks.notes) && ENV.LLM_MODEL.startsWith("openai/") && !ENV.OPENAI_API_KEY) throw new Error("The configured LLM requires OPENAI_API_KEY");
    if ((!mocks.knowledge || !mocks.notes) && ENV.LLM_MODEL.startsWith("anthropic/") && !ENV.ANTHROPIC_API_KEY) throw new Error("The configured LLM requires ANTHROPIC_API_KEY");
    if (store instanceof PostgresStore && mocks.auth) await store.provisionDemoUser();
    if (knowledge instanceof QdrantKnowledgeEngine) knowledge.hydrate(await store.listReadyContexts());
    if (slides instanceof FileSlideProcessor) await slides.checkDependencies();
    runner.start();
  };

  const health = (): HealthResponse => ({ status: "ok", version: "0.1.0", mocks: { ...mocks }, ts: Date.now() });
  const engines = { captions: live.captions.name, stt: stt.name, tts: tts.name, knowledge: knowledge.name, notes: notes.name, store: store.name };

  return { store, assets, slides, knowledge, notes, resolveUser, live, platform, jobs, runner, initialize, health, engines };
}

export type Container = ReturnType<typeof createContainer>;
