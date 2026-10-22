/**
 * Composition root: picks real vs mock implementations from the MOCK_* flags (see config.ts).
 * Shared file — Tushar owns the platform wiring, Ashwath owns the intelligence line.
 */
import type { HealthResponse } from "@sightline/contracts";

import { config } from "./config";
import { ENV } from "./env.server";
import { createIntelligenceEngine } from "./modules/intelligence";
import { DiskAssetStore, MemoryAssetStore } from "./modules/platform/assets/asset-store";
import { createUserResolver } from "./modules/platform/auth";
import { PlatformService } from "./modules/platform/platform-service";
import { SessionHub } from "./modules/platform/realtime/hub";
import { LiveCaptions } from "./modules/platform/realtime/live-captions";
import { FileSlideProcessor, MockSlideProcessor } from "./modules/platform/slides/slide-processor";
import { DeepgramStt } from "./modules/platform/speech/deepgram-stt";
import { MockReplayStt } from "./modules/platform/speech/mock-stt";
import { MockTts, ProviderTts } from "./modules/platform/speech/tts";
import { MemoryStore } from "./modules/platform/store/memory-store";
import { PostgresStore } from "./modules/platform/store/postgres-store";
import { auth, db } from "./services";

export function createContainer() {
  const { mocks } = config;
  const assetUrl = (assetId: string) => `${config.publicUrl}/api/assets/${assetId}`;

  const hub = new SessionHub();
  const intelligence = createIntelligenceEngine({ mock: mocks.intelligence });
  const store = mocks.persistence ? new MemoryStore() : new PostgresStore(db);
  const assets = mocks.persistence ? new MemoryAssetStore() : new DiskAssetStore(config.storageDir);
  const slides = mocks.slides ? new MockSlideProcessor(assets, assetUrl) : new FileSlideProcessor();
  const stt = mocks.speech ? new MockReplayStt(config.mockReplaySpeed) : new DeepgramStt(ENV.DEEPGRAM_API_KEY, ENV.DEEPGRAM_MODEL);
  const tts = mocks.speech
    ? new MockTts()
    : new ProviderTts(
        ENV.TTS_PROVIDER,
        ENV.TTS_PROVIDER === "sarvam" ? ENV.SARVAM_API_KEY : ENV.ELEVENLABS_API_KEY,
        ENV.ELEVENLABS_VOICE_ID,
      );
  const live = new LiveCaptions({ store, stt, intelligence, hub });
  const platform = new PlatformService({ store, intelligence, tts, slides, assets, hub, live, assetUrl });
  const resolveUser = createUserResolver({ mock: mocks.auth, auth });

  const health = (): HealthResponse => ({ status: "ok", version: "0.1.0", mocks: { ...mocks }, ts: Date.now() });

  return { hub, intelligence, store, assets, slides, stt, tts, live, platform, resolveUser, health };
}

export type Container = ReturnType<typeof createContainer>;
