import type { SocketHandlers } from "@/lib/realtime/socket";
import type { SignServiceCommand, SignServiceMessage } from "@/types/realtime";

import { createMockSocket } from "./mock-socket";

export const MOCK_PHRASES = [
  ["PLEASE", "REPEAT", "FORMULA"],
  ["WHAT", "MEAN", "KVL"],
  ["SLOW", "PLEASE"],
];

const VOCABULARY = [...new Set(MOCK_PHRASES.flat()), "QUESTION", "THANK-YOU", "OHM"];
const SIGN_MS = 1100;
const PHRASE_GAP_MS = 5000;

/** Fake recogniser: once a stream starts, "recognises" a scripted phrase every few seconds. Frames are ignored. */
export function mockSignService(handlers: SocketHandlers<SignServiceMessage>) {
  return createMockSocket<SignServiceMessage, SignServiceCommand>(handlers, ({ emit, after, clearTimers }) => {
    let phrase = 0;
    let tokenCount = 0;
    let streaming = false;

    emit({ type: "service.ready", protocolVersion: "1", model: "mock-sign", vocabulary: VOCABULARY, ts: Date.now() });

    const sign = () => {
      const glosses = MOCK_PHRASES[phrase++ % MOCK_PHRASES.length]!;
      const tokenIds: string[] = [];
      emit({ type: "hands.status", handsDetected: 2, ts: Date.now() });

      glosses.forEach((gloss, i) => {
        after(i * SIGN_MS + 400, () =>
          emit({ type: "sign.partial", gloss, confidence: 0.6, ts: Date.now() }),
        );
        after((i + 1) * SIGN_MS, () => {
          const id = `tok_mock_${tokenCount++}`;
          tokenIds.push(id);
          emit({ type: "sign.token", token: { id, gloss, kind: "SIGN", confidence: 0.9, ts: Date.now() }, ts: Date.now() });
        });
      });

      const done = (glosses.length + 1) * SIGN_MS;
      after(done, () => {
        emit({ type: "hands.status", handsDetected: 0, ts: Date.now() });
        emit({ type: "phrase.end", tokenIds, ts: Date.now() });
      });
      after(done + PHRASE_GAP_MS, sign);
    };

    return {
      onCommand: (command) => {
        if (command.type === "stream.start") {
          streaming = true;
          clearTimers();
          after(1500, sign);
        }
        if (command.type === "phrase.reset" && streaming) {
          clearTimers();
          emit({ type: "hands.status", handsDetected: 0, ts: Date.now() });
          after(PHRASE_GAP_MS, sign);
        }
        if (command.type === "stream.stop") {
          streaming = false;
          clearTimers();
          emit({ type: "hands.status", handsDetected: 0, ts: Date.now() });
        }
      },
    };
  });
}
