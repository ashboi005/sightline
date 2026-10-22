/**
 * OWNER: Ashwath — the core live module: realtime socket, STT → captions → refinement, TTS, sign sentences.
 * Depends on the platform module only through shared/ports.ts + the contract KnowledgeEngine.
 */
import type { KnowledgeEngine } from "@sightline/contracts";

import type { GatewayConfig } from "../../lib/llm-gateway";
import type { AssetStore, SessionLifecycle, SessionStore, UserResolver } from "../../shared/ports";
import { createMastraGenerate } from "./captions/llm";
import { MastraCaptionEngine } from "./captions/mastra-caption-engine";
import { MockCaptionEngine } from "./captions/mock-caption-engine";
import { captionDevRoutes } from "./dev-routes";
import { SessionHub } from "./realtime/hub";
import { LiveCaptions } from "./realtime/live-captions";
import { sessionSocket } from "./realtime/socket";
import { liveRoutes } from "./routes";
import { SignUtterances } from "./sign-utterances";
import { LexicalSlideLocator } from "./slides/slide-locator";
import type { SpeechToText, TextToSpeech } from "./speech/types";

export type CaptionConfig =
  | { mock: true }
  | { mock: false; gateway: GatewayConfig; captionModel: string; signModel: string; timeoutMs: number; useRag: boolean };

export function createLiveModule(deps: {
  captions: CaptionConfig;
  stt: SpeechToText;
  tts: TextToSpeech;
  store: SessionStore;
  assets: AssetStore;
  knowledge: KnowledgeEngine;
  resolveUser: UserResolver;
  assetUrl: (assetId: string) => string;
}) {
  const { store, knowledge, resolveUser } = deps;
  const hub = new SessionHub();
  const captions = deps.captions.mock
    ? new MockCaptionEngine(knowledge)
    : new MastraCaptionEngine({
        generate: createMastraGenerate(deps.captions),
        knowledge,
        captionTimeoutMs: deps.captions.timeoutMs,
        useRag: deps.captions.useRag,
      });
  const slides = new LexicalSlideLocator(store);
  const live = new LiveCaptions({ store, stt: deps.stt, captions, knowledge, slides, events: hub });
  const sign = new SignUtterances({ store, captions, tts: deps.tts, assets: deps.assets, events: hub, assetUrl: deps.assetUrl });

  const lifecycle: SessionLifecycle = {
    async onSessionStarted(session) {
      // Mock speech: the scripted lecture starts with the session. Real STT starts on the socket's audio.start.
      if (live.isReplay) await live.start(session.id, session.startedAt ?? Date.now());
    },
    onSessionEnded: (sessionId) => live.stop(sessionId),
    onSessionDeleted: (sessionId) => live.stop(sessionId),
  };

  return {
    captions,
    events: hub,
    lifecycle,
    routes: liveRoutes({ store, resolveUser, sign }),
    socket: sessionSocket({ store, hub, live, resolveUser }),
    devRoutes: captionDevRoutes(captions, slides),
  };
}
