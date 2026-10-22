/**
 * OWNER: Ashwath — the core live module: realtime socket, STT → captions → refinement, TTS, sign sentences.
 * Depends on the platform module only through shared/ports.ts + the contract KnowledgeEngine.
 */
import type { KnowledgeEngine } from "@sightline/contracts";

import type { AssetStore, SessionLifecycle, SessionStore, UserResolver } from "../../shared/ports";
import { MastraCaptionEngine } from "./captions/mastra-caption-engine";
import { MockCaptionEngine } from "./captions/mock-caption-engine";
import { captionDevRoutes } from "./dev-routes";
import { SessionHub } from "./realtime/hub";
import { LiveCaptions } from "./realtime/live-captions";
import { sessionSocket } from "./realtime/socket";
import { liveRoutes } from "./routes";
import { SignUtterances } from "./sign-utterances";
import type { SpeechToText, TextToSpeech } from "./speech/types";

export function createLiveModule(deps: {
  mockCaptions: boolean;
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
  const captions = deps.mockCaptions ? new MockCaptionEngine(knowledge) : new MastraCaptionEngine(knowledge);
  const live = new LiveCaptions({ store, stt: deps.stt, captions, knowledge, events: hub });
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
    devRoutes: captionDevRoutes(captions),
  };
}
