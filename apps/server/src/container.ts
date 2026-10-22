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
import { MockReplayStt } from "./modules/live/speech/mock-stt";
import { CachedTts, ElevenLabsTts, MockTts, SarvamTts } from "./modules/live/speech/tts";
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

export function createContainer() {
  const { mocks } = config;
  const llmGateway = { url: ENV.LLM_GATEWAY_URL, apiKey: ENV.MERGE_GATEWAY_API_KEY };
  const assetUrl = (assetId: string) => `${config.publicUrl}/api/assets/${assetId}`;

  // --- surrounding (Tushar) ------------------------------------------------
  const store = mocks.persistence ? new MemoryStore() : new PostgresStore(db);
  const assets = mocks.persistence ? new MemoryAssetStore() : new DiskAssetStore(config.storageDir);
  const slides = mocks.slides ? new MockSlideProcessor(assets, assetUrl) : new FileSlideProcessor();
  const knowledge: KnowledgeEngine = mocks.knowledge
    ? new MockKnowledgeEngine()
    : new QdrantKnowledgeEngine(ENV.QDRANT_URL, ENV.QDRANT_API_KEY, ENV.EMBEDDING_MODEL);
  const notes: NotesEngine = mocks.notes ? new MockNotesEngine() : new LlmNotesEngine(knowledge);
  const resolveUser = createUserResolver({ mock: mocks.auth, auth });

  // --- core (Ashwath) ------------------------------------------------------
  const stt = mocks.speech ? new MockReplayStt(config.mockReplaySpeed) : new DeepgramStt({
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
        timeoutMs: ENV.CAPTION_TIMEOUT_MS,
        useRag: ENV.CAPTIONS_USE_RAG,
      };
  const live = createLiveModule({ captions, stt, tts, store, assets, knowledge, resolveUser, assetUrl });

  // --- platform uses the live module only via lifecycle + events -----------
  const platform = new PlatformService({ store, knowledge, notes, slides, assets, events: live.events, lifecycle: live.lifecycle });

  const health = (): HealthResponse => ({ status: "ok", version: "0.1.0", mocks: { ...mocks }, ts: Date.now() });
  const engines = { captions: live.captions.name, stt: stt.name, tts: tts.name, knowledge: knowledge.name, notes: notes.name, store: store.name };

  return { store, assets, slides, knowledge, notes, resolveUser, live, platform, health, engines };
}

export type Container = ReturnType<typeof createContainer>;
