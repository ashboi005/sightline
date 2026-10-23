"use client";

import type { SignServiceCommand, SignSource, SignToken } from "@sightline/contracts";
import { connectSignService, type SocketStatus, type TypedSocket } from "@sightline/contracts/client";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { SIGN_SERVICE_URL } from "@/lib/config";
import { createSignServiceController, initialSignServiceState } from "@/lib/live/sign-service-controller";

/** React adapter for the tested sign recognition lifecycle. */
export function useSignService(options: {
  enabled?: boolean;
  onPhrase?: (tokens: SignToken[], source: SignSource) => void | Promise<void>;
} = {}) {
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<SocketStatus>("CLOSED");
  const [state, setState] = useState(initialSignServiceState);
  const socketRef = useRef<TypedSocket<SignServiceCommand> | null>(null);
  const onPhrase = useEffectEvent((tokens: SignToken[], source: SignSource) => options.onPhrase?.(tokens, source));
  const [controller] = useState(() => createSignServiceController({
    send: command => socketRef.current?.send(command),
    changed: setState,
    phrase: (tokens, source) => onPhrase(tokens, source),
  }));

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const socket = connectSignService(SIGN_SERVICE_URL, {
      onMessage: message => { if (current) controller.message(message); },
      onStatus: next => {
        if (!current) return;
        setStatus(next);
        controller.status(next);
      },
    });
    socketRef.current = socket;
    return () => {
      // A disposed effect must not overwrite a newer socket's readiness or phrase.
      current = false;
      controller.stop();
      socket.close();
      socketRef.current = null;
      setStatus("CLOSED");
      controller.status("CLOSED");
    };
  }, [enabled, controller]);

  return { ...state, status, start: controller.start, stop: controller.stop,
    reset: controller.reset, sendFrame: controller.sendFrame,
    editDraft: controller.editDraft, space: controller.space, backspace: controller.backspace, submit: controller.submit };
}
