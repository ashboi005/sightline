import { SIGN_SERVICE_PROTOCOL_VERSION, type SignServiceCommand, type SignServiceMessage, type SignSource, type SignToken } from "@sightline/contracts";
import type { SocketStatus } from "@sightline/contracts/client";

type StartOptions = { source?: SignSource; fps?: number; width?: number; height?: number };
export type SignServiceState = {
  ready: boolean;
  active: boolean;
  streaming: boolean;
  handsDetected: number;
  partial: string | null;
  draft: string;
  submitting: boolean;
  error: string | null;
};
export const initialSignServiceState: SignServiceState = {
  ready: false, active: false, streaming: false, handsDetected: 0,
  partial: null, draft: "", submitting: false, error: null,
};

const MAX_DRAFT_LENGTH = 2048;

/** Accepted letters build a local draft. Only explicit submit invokes the app API. */
export function createSignServiceController(callbacks: {
  send: (command: SignServiceCommand) => void;
  changed: (state: SignServiceState) => void;
  phrase: (tokens: SignToken[], source: SignSource) => void | Promise<void>;
  now?: () => number;
}) {
  const now = callbacks.now ?? Date.now;
  let state = { ...initialSignServiceState };
  let desired: Extract<SignServiceCommand, { type: "stream.start" }> | null = null;
  let seq = 0;
  let segmentAccepted = "";
  let draftSource: SignSource | null = null;
  let draftConfidence = 1;
  let recognitionAfter = 0;
  const seen = new Set<string>();
  const pendingTokens = new Set<string>();
  const update = (patch: Partial<SignServiceState>) => {
    state = { ...state, ...patch };
    callbacks.changed(state);
  };
  const clearRecognition = () => {
    segmentAccepted = "";
    pendingTokens.clear();
    recognitionAfter = now();
    update({ partial: null, handsDetected: 0 });
  };
  const resetRemotePhrase = () => {
    clearRecognition();
    if (state.ready) callbacks.send({ type: "phrase.reset" });
  };
  const editDraft = (text: string, source?: SignSource) => {
    if (state.submitting) return;
    const draft = text.replace(/[\r\n\t]/g, " ").slice(0, MAX_DRAFT_LENGTH);
    if (!draft.trim()) {
      draftSource = null;
      draftConfidence = 1;
    } else {
      draftSource ??= source ?? desired?.source ?? "SELF";
    }
    update({ draft, error: null });
  };
  const resume = () => {
    if (!state.ready || !desired || state.streaming) return;
    seq = 0;
    seen.clear();
    clearRecognition();
    callbacks.send(desired);
    update({ streaming: true, error: null });
  };
  return {
    get state() { return state; },
    status(next: SocketStatus) {
      if (next !== "OPEN") {
        clearRecognition();
        update({ ready: false, streaming: false });
      }
    },
    message(message: SignServiceMessage) {
      if (message.type === "service.ready") {
        if (message.protocolVersion !== SIGN_SERVICE_PROTOCOL_VERSION) {
          update({ ready: false, streaming: false, error: "Unsupported sign-service protocol version." });
          return;
        }
        update({ ready: true, error: null });
        resume();
        return;
      }
      if (message.type === "error") {
        update({ error: message.message, ...(message.code === "MODEL_UNAVAILABLE" ? { ready: false, streaming: false } : {}) });
        return;
      }
      if (!state.streaming || message.ts <= recognitionAfter) return;
      if (message.type === "hands.status") {
        update({ handsDetected: message.handsDetected });
        return;
      }
      if (state.submitting) return;
      switch (message.type) {
        case "sign.partial": {
          const accepted = message.acceptedGloss ?? "";
          const added = accepted.startsWith(segmentAccepted) ? accepted.slice(segmentAccepted.length) : accepted;
          segmentAccepted = accepted;
          if (added) {
            editDraft(state.draft + added);
            draftConfidence = Math.min(draftConfidence, message.confidence);
          }
          const candidate = message.gloss.startsWith(accepted) ? message.gloss.slice(accepted.length) : message.gloss;
          update({ partial: candidate || null });
          break;
        }
        case "sign.token":
          // Word reconstruction is not a manual word boundary. Keep IDs only to
          // recognize a completed raw-letter segment, never replace the draft.
          if (seen.has(message.token.id)) return;
          seen.add(message.token.id);
          if (seen.size > 4096) seen.delete(seen.values().next().value!);
          pendingTokens.add(message.token.id);
          break;
        case "phrase.end":
          if (!message.tokenIds.some(id => pendingTokens.has(id))) return;
          for (const id of message.tokenIds) pendingTokens.delete(id);
          segmentAccepted = "";
          update({ partial: null });
          break;
      }
    },
    start(options: StartOptions = {}) {
      const source = options.source ?? "SELF";
      if (draftSource && source !== draftSource) {
        update({ error: "Send or clear the current sentence before changing signer." });
        return;
      }
      desired = { type: "stream.start", protocolVersion: SIGN_SERVICE_PROTOCOL_VERSION,
        source, fps: options.fps ?? 12,
        width: options.width ?? 640, height: options.height ?? 480 };
      update({ active: true, streaming: false });
      resume();
    },
    sendFrame(image: string) {
      if (state.ready && state.streaming && !state.submitting) {
        callbacks.send({ type: "frame", seq: seq++, image, ts: now() });
      }
    },
    stop() {
      desired = null;
      if (state.ready) callbacks.send({ type: "stream.stop" });
      clearRecognition();
      update({ active: false, streaming: false });
    },
    editDraft,
    space() {
      if (state.draft && !state.draft.endsWith(" ")) editDraft(state.draft + " ");
    },
    backspace() {
      editDraft(state.draft.slice(0, -1));
    },
    reset() {
      if (state.submitting) return;
      resetRemotePhrase();
      editDraft("");
    },
    async submit(): Promise<boolean> {
      if (state.submitting || !state.draft.trim()) return false;
      const words = state.draft.trim().split(/\s+/);
      if (words.length > 64) {
        update({ error: "Please send at most 64 words at a time." });
        return false;
      }
      const source = draftSource ?? desired?.source ?? "SELF";
      const ts = now();
      const tokens: SignToken[] = words.map(gloss => ({
        id: "tok_" + crypto.randomUUID(), gloss, kind: "FINGERSPELL",
        confidence: draftConfidence, ts,
      }));
      update({ submitting: true, error: null });
      resetRemotePhrase();
      try {
        await callbacks.phrase(tokens, source);
        draftSource = null;
        draftConfidence = 1;
        update({ draft: "" });
        return true;
      } catch (error) {
        update({ error: error instanceof Error ? error.message : "Could not send the sentence. Try again." });
        return false;
      } finally {
        // Queued recognition during saving must not enter the next sentence.
        resetRemotePhrase();
        update({ submitting: false });
      }
    },
  };
}
