/**
 * Composition root: picks real vs mock implementations from the MOCK_* flags (see config.ts).
 *
 *   core (Ashwath)        modules/live      — captions, speech, realtime socket, sign sentences
 *   surrounding (Tushar)  modules/platform  — sessions, store, slides, knowledge (RAG), notes, auth
 */
import type { HealthResponse, KnowledgeEngine, NotesEngine } from "@sightline/contracts";

import { config } from "./config";
import { ENV } from "./env.server";
import { createLiveModule } from "./modules/live";
import { DeepgramStt } from "./modules/live/speech/deepgram-stt";
import { ElevenLabsStt } from "./modules/live/speech/elevenlabs-stt";
import { SarvamStt } from "./modules/live/speech/sarvam-stt";
import { MockReplayStt } from "./modules/live/speech/mock-stt";
import { CachedTts, ElevenLabsTts, MockTts, SarvamTts } from "./modules/live/speech/tts";
import { LocalObjectStorage, type ObjectStorage, S3ObjectStorage } from "./lib/storage";
import { ObjectAssetStore } from "./modules/platform/assets/asset-store";
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

export function createContainer() {
  const { mocks } = config;
  const llmGateway = { url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY };
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
  const assets = new ObjectAssetStore(storage);
  const recordings = new RecordingService({ store, storage, urlTtlSeconds: ENV.STORAGE_URL_TTL_SECONDS });
  const slides = mocks.slides ? new MockSlideProcessor(assets, assetUrl) : new FileSlideProcessor();
  const knowledge: KnowledgeEngine = mocks.knowledge
    ? new MockKnowledgeEngine()
    : new QdrantKnowledgeEngine(ENV.QDRANT_URL, ENV.QDRANT_API_KEY, ENV.EMBEDDING_MODEL);
  const notes: NotesEngine = mocks.notes ? new MockNotesEngine() : new LlmNotesEngine(knowledge);
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
  const platform = new PlatformService({ store, knowledge, notes, slides, assets, events: live.events, lifecycle: live.lifecycle });

  const health = (): HealthResponse => ({ status: "ok", version: "0.1.0", mocks: { ...mocks }, ts: Date.now() });
  const engines = { storage: storage.driver, captions: live.captions.name, stt: stt.name, tts: tts.name, knowledge: knowledge.name, notes: notes.name, store: store.name };

  return { store, storage, assets, assetUrl, recordings, slides, knowledge, notes, resolveUser, live, platform, health, engines };
}

export type Container = ReturnType<typeof createContainer>;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return value;
}
