"use client";

import {
  SIGN_SERVICE_PROTOCOL_VERSION,
  type SignServiceCommand,
  type SignServiceMessage,
  type SignSource,
  type SignToken,
} from "@sightline/contracts";
import { connectSignService, type SocketStatus, type TypedSocket } from "@sightline/contracts/client";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { SIGN_SERVICE_URL } from "@/lib/config";

/**
 * Connects to the sign recogniser. Call `start()`, then feed webcam frames with `sendFrame` (see
 * `startWebcamFrames`). Committed signs build up in `tokens`; when the signer pauses, `onPhrase` gets the
 * finished phrase. Pass it to `useCreateSignUtterance` to get a sentence and speech back:
 *
 *   const utter = useCreateSignUtterance(sessionId);
 *   const sign = useSignService({ onPhrase: (tokens, source) => utter.mutate({ tokens, source }) });
 */
export function useSignService(
  options: { enabled?: boolean; onPhrase?: (tokens: SignToken[], source: SignSource) => void } = {},
) {
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<SocketStatus>("CLOSED");
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [handsDetected, setHandsDetected] = useState(0);
  /** Live best guess for the sign in progress. Show it greyed out. */
  const [partial, setPartial] = useState<string | null>(null);
  const [tokens, setTokens] = useState<SignToken[]>([]);
  const [streaming, setStreaming] = useState(false);
  const socketRef = useRef<TypedSocket<SignServiceCommand> | null>(null);
  const tokensRef = useRef<SignToken[]>([]);
  const sourceRef = useRef<SignSource>("SELF");
  const seqRef = useRef(0);

  const setPhrase = (next: SignToken[]) => {
    tokensRef.current = next;
    setTokens(next);
  };

  const handleMessage = useEffectEvent((message: SignServiceMessage) => {
    switch (message.type) {
      case "service.ready":
        return setVocabulary(message.vocabulary);
      case "hands.status":
        return setHandsDetected(message.handsDetected);
      case "sign.partial":
        return setPartial(message.gloss);
      case "sign.token":
        setPartial(null);
        return setPhrase([...tokensRef.current, message.token]);
      case "phrase.end": {
        const phrase = tokensRef.current.filter((t) => message.tokenIds.includes(t.id));
        setPhrase([]);
        setPartial(null);
        if (phrase.length > 0) options.onPhrase?.(phrase, sourceRef.current);
        return;
      }
      case "error":
        return console.warn("[sign] service error", message.code, message.message);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = connectSignService(SIGN_SERVICE_URL, { onMessage: (m) => handleMessage(m), onStatus: setStatus });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
      setStreaming(false);
    };
  }, [enabled]);

  const send = (command: SignServiceCommand) => socketRef.current?.send(command);

  return {
    status,
    vocabulary,
    handsDetected,
    partial,
    /** Signs committed so far in the current phrase. */
    tokens,
    streaming,
    /** SELF = the student signs; PEER = a classmate signs at the camera. */
    start: (opts: { source?: SignSource; fps?: number; width?: number; height?: number } = {}) => {
      sourceRef.current = opts.source ?? "SELF";
      seqRef.current = 0;
      send({
        type: "stream.start",
        protocolVersion: SIGN_SERVICE_PROTOCOL_VERSION,
        source: sourceRef.current,
        fps: opts.fps ?? 12,
        width: opts.width ?? 640,
        height: opts.height ?? 480,
      });
      setStreaming(true);
    },
    sendFrame: (base64Jpeg: string) => send({ type: "frame", seq: seqRef.current++, image: base64Jpeg, ts: Date.now() }),
    stop: () => {
      send({ type: "stream.stop" });
      setStreaming(false);
      setPhrase([]);
      setPartial(null);
    },
    /** The student pressed "clear": drop the phrase in progress. */
    reset: () => {
      send({ type: "phrase.reset" });
      setPhrase([]);
      setPartial(null);
    },
  };
}
