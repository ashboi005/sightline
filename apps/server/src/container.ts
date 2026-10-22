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
import { ElevenLabsStt } from "./modules/live/speech/elevenlabs-stt";
import { SarvamStt } from "./modules/live/speech/sarvam-stt";
import { MockReplayStt } from "./modules/live/speech/mock-stt";
import { CachedTts, ElevenLabsTts, MockTts, SarvamTts } from "./modules/live/speech/tts";
import { KeyPool } from "./lib/key-pool";
import type { GatewayConfig } from "./lib/llm-gateway";
import { LocalObjectStorage, type ObjectStorage, S3ObjectStorage } from "./lib/storage";
import { MemoryAssetIndex, ObjectAssetStore, PostgresAssetIndex } from "./modules/platform/assets/asset-store";
import { RecordingService } from "./modules/recordings/recording-service";
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
  // Gemini keys (up to 4 projects) rotate per call: embeddings, and any *_MODEL set to "gemini/<model>".
  const geminiKeys = new KeyPool("gemini", [ENV.GEMINI_API_KEY, ENV.GEMINI_API_KEY_2, ENV.GEMINI_API_KEY_3, ENV.GEMINI_API_KEY_4]);
  const llmGateway: GatewayConfig = { url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY, gemini: { url: ENV.GEMINI_BASE_URL, pool: geminiKeys } };
  const assetUrl = (assetId: string) => `${config.publicUrl}/api/assets/${assetId}`;

  // --- surrounding (Tushar) ------------------------------------------------
  const store = mocks.persistence ? new MemoryStore() : new PostgresStore(db);
  const storage: ObjectStorage =
    ENV.STORAGE_DRIVER === "s3"
      ? new S3ObjectStorage({
          bucket: requireEnv(ENV.S3_BUCKET, "S3_BUCKET"),
          region: ENV.S3_REGION,
          endpoint: ENV.S3_ENDPOINT || undefined,
          accessKeyId: requireEnv(ENV.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID"),
          secretAccessKey: requireEnv(ENV.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY"),
          urlTtlSeconds: ENV.STORAGE_URL_TTL_SECONDS,
        })
      : new LocalObjectStorage({
          dir: config.storageDir,
          publicUrl: config.publicUrl,
          secret: ENV.BETTER_AUTH_SECRET,
          urlTtlSeconds: ENV.STORAGE_URL_TTL_SECONDS,
        });
  // Bytes in ObjectStorage (S3 in prod); ownership metadata in Postgres (or memory in mock mode).
  const assets = new ObjectAssetStore(storage, mocks.persistence ? new MemoryAssetIndex(store) : new PostgresAssetIndex(db));
  const recordings = new RecordingService({ store, storage, urlTtlSeconds: ENV.STORAGE_URL_TTL_SECONDS });
  const slides = mocks.slides ? new MockSlideProcessor(assets, assetUrl) : new FileSlideProcessor(assets, assetUrl);
  // All LLM calls go through Merge Gateway (LLM_MODEL, default zai/glm-5.3-flash).
  const model = new MastraStructuredModel(llmGateway, ENV.LLM_MODEL, { timeoutMs: ENV.PLATFORM_LLM_TIMEOUT_MS });
  const knowledge: KnowledgeEngine = mocks.knowledge
    ? new MockKnowledgeEngine()
    : new QdrantKnowledgeEngine({ client: new QdrantClient({ url: ENV.QDRANT_URL, port: qdrantPort(ENV.QDRANT_URL), apiKey: ENV.QDRANT_API_KEY || undefined, timeout: 30_000 }),
        embeddings: new OpenAIEmbeddings(geminiKeys, ENV.EMBEDDING_MODEL, { baseURL: ENV.GEMINI_BASE_URL, dimensions: ENV.EMBEDDING_DIMENSIONS }),
        model, dimensions: ENV.EMBEDDING_DIMENSIONS });
  const notes: NotesEngine = mocks.notes ? new MockNotesEngine() : new LlmNotesEngine(knowledge, model);
  const resolveUser = createUserResolver({ mock: mocks.auth, auth });

  // --- core (Ashwath) ------------------------------------------------------
  const stt = mocks.speech
    ? new MockReplayStt(config.mockReplaySpeed)
    : ENV.STT_PROVIDER === "elevenlabs"
      ? new ElevenLabsStt({
          apiKey: ENV.ELEVENLABS_API_KEY,
          model: ENV.ELEVENLABS_STT_MODEL,
          language: ENV.ELEVENLABS_STT_LANGUAGE,
          vadSilenceSecs: ENV.ELEVENLABS_STT_VAD_SILENCE_SECS,
          baseUrl: ENV.ELEVENLABS_URL || undefined,
        })
      : ENV.STT_PROVIDER === "sarvam"
      ? new SarvamStt({
          apiKey: ENV.SARVAM_API_KEY,
          model: ENV.SARVAM_STT_MODEL,
          mode: ENV.SARVAM_STT_MODE,
          language: ENV.SARVAM_STT_LANGUAGE,
          baseUrl: ENV.SARVAM_STT_URL || undefined,
        })
      : new DeepgramStt({
          apiKey: ENV.DEEPGRAM_API_KEY,
          model: ENV.DEEPGRAM_MODEL,
          language: ENV.DEEPGRAM_LANGUAGE,
          baseUrl: ENV.DEEPGRAM_URL || undefined,
        });
  const tts = mocks.speech
    ? new MockTts()
    : new CachedTts(
        ENV.TTS_PROVIDER === "sarvam"
          ? new SarvamTts({
              apiKey: ENV.SARVAM_API_KEY,
              model: ENV.SARVAM_TTS_MODEL,
              speaker: ENV.SARVAM_SPEAKER,
              language: ENV.SARVAM_LANGUAGE,
            })
          : new ElevenLabsTts({
              apiKey: ENV.ELEVENLABS_API_KEY,
              voiceId: ENV.ELEVENLABS_VOICE_ID,
              modelId: ENV.ELEVENLABS_MODEL_ID,
            }),
      );
  const captions = mocks.captions
    ? ({ mock: true } as const)
    : {
        mock: false as const,
        gateway: llmGateway,
        captionModel: ENV.CAPTION_MODEL,
        signModel: ENV.SIGN_MODEL,
        signLanguage: ENV.SIGN_OUTPUT_LANGUAGE,
        visionModel: ENV.VISION_MODEL,
        timeoutMs: ENV.CAPTION_TIMEOUT_MS,
        useRag: ENV.CAPTIONS_USE_RAG,
      };
  const live = createLiveModule({ captions, stt, tts, store, assets, knowledge, resolveUser, assetUrl });

  // --- platform uses the live module only via lifecycle + events -----------
  const jobs = mocks.persistence ? new MemoryJobs(store) : new PostgresJobs(db);
  const platform = new PlatformService({ store, knowledge, notes, slides, assets, storage, recordingCleanupDelayMs: (ENV.STORAGE_URL_TTL_SECONDS + 300) * 1000, events: live.events, lifecycle: live.lifecycle, jobs });
  const runner = new JobRunner(jobs, (job) => platform.executeJob(job));
  const initialize = async () => {
    if (!mocks.knowledge && !geminiKeys.size) throw new Error("Real knowledge requires GEMINI_API_KEY (embeddings)");
    if ((!mocks.knowledge || !mocks.notes) && !ENV.MERGE_GATEWAY_API_KEY) throw new Error("Real knowledge/notes require MERGE_GATEWAY_API_KEY (LLM)");
    if (store instanceof PostgresStore && mocks.auth) await store.provisionDemoUser();
    if (knowledge instanceof QdrantKnowledgeEngine) knowledge.hydrate(await store.listReadyContexts());
    runner.start();
  };

  const health = (): HealthResponse => ({ status: "ok", version: "0.1.0", mocks: { ...mocks }, ts: Date.now() });
  const engines = { storage: storage.driver, captions: live.captions.name, stt: stt.name, tts: tts.name, knowledge: knowledge.name, notes: notes.name, store: store.name };

  return { store, storage, assets, assetUrl, recordings, slides, knowledge, notes, resolveUser, live, platform, jobs, runner, initialize, health, engines };
}

export type Container = ReturnType<typeof createContainer>;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return value;
}

/** The Qdrant client appends :6333 when the URL has no port — wrong behind a proxy (Coolify serves Qdrant on 80/443). */
function qdrantPort(url: string) {
  return Number(new URL(url).port) || null;
}
