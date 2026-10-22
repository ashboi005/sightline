import type { SignUtterance } from "@sightline/contracts";

import { assetUrl } from "@/lib/api";

// One record per page of which sign utterances have been spoken, so a sentence that arrives twice (the REST
// response and the session socket's `sign.utterance`) is only heard once.
const spoken = new Set<string>();

/**
 * Says an utterance out loud: its TTS audio, or the browser's voice when the server sent none and
 * `browserVoice` is allowed. Skips anything already spoken unless `again` (the "Play again" button).
 */
export function speakUtterance(u: SignUtterance, options: { again?: boolean; browserVoice?: boolean } = {}) {
  if (!options.again && spoken.has(u.id)) return;
  spoken.add(u.id);
  if (u.audioUrl) {
    void new Audio(assetUrl(u.audioUrl)).play().catch(() => {});
  } else if (options.browserVoice && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(u.text));
  }
}
