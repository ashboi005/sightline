/**
 * OWNER: Ashwath. Sign gloss → sentence (CaptionEngine) → speech (TTS) → broadcast.
 */
import type { CaptionEngine, CreateSignUtteranceInput, SignUtterance } from "@sightline/contracts";

import { newId } from "../../lib/ids";
import type { AssetStore, SessionEvents, SessionStore } from "../../shared/ports";
import type { TextToSpeech } from "./speech/types";

export class SignUtterances {
  constructor(
    private readonly deps: {
      store: SessionStore;
      captions: CaptionEngine;
      tts: TextToSpeech;
      assets: AssetStore;
      events: SessionEvents;
      assetUrl: (assetId: string) => string;
    },
  ) {}

  async create(sessionId: string, input: CreateSignUtteranceInput): Promise<SignUtterance> {
    const { store, captions, tts, assets, events } = this.deps;

    const recentCaptions = (await store.listSegments(sessionId)).slice(-5).map((s) => s.text);
    const composed = await captions.composeSignSentence({ sessionId, tokens: input.tokens, source: input.source, recentCaptions });

    let audioUrl: string | null = null;
    if (input.speak) {
      try {
        const audio = await tts.synthesize(composed.text);
        audioUrl = this.deps.assetUrl(await assets.put(audio.contentType, audio.bytes, sessionId));
      } catch (error) {
        console.warn("[live] TTS failed, returning text only", error);
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
    events.publish(sessionId, { type: "sign.utterance", utterance, ts: Date.now() });
    return utterance;
  }
}
