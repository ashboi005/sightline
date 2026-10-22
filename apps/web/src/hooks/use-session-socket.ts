"use client";

import type {
  CaptionSegment,
  ProcessingStatus,
  Session,
  SessionClientMessage,
  SessionServerMessage,
  SignUtterance,
  SlidePointer,
  Snapshot,
} from "@sightline/contracts";
import { connectSessionSocket, type SocketStatus, type TypedSocket } from "@sightline/contracts/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useReducer, useState } from "react";

import { api } from "@/lib/api";
import { SERVER_WS_URL } from "@/lib/config";
import { keys } from "@/lib/query-keys";
import { applyCaptionMessage, emptyCaptions, upsertCaptions, type CaptionState } from "@/lib/realtime/captions";

export type LiveSessionState = {
  /** Which lecture this state belongs to; anything else is ignored. */
  sessionId: string | null;
  session: Session | null;
  /** Captions come from the server's recorded lecture (MOCK_SPEECH), so the mic isn't needed. */
  isReplay: boolean;
  captions: CaptionState;
  slidePointer: SlidePointer | null;
  notesStatus: ProcessingStatus | null;
  lastError: { code: string; message: string } | null;
};

const initial = (sessionId: string | null): LiveSessionState => ({
  sessionId,
  session: null,
  isReplay: false,
  captions: emptyCaptions,
  slidePointer: null,
  notesStatus: null,
  lastError: null,
});

type Action =
  | { type: "reset"; sessionId: string | null }
  | { type: "message"; sessionId: string; message: SessionServerMessage }
  | { type: "backfill"; sessionId: string; segments: CaptionSegment[] };

function reducer(state: LiveSessionState, action: Action): LiveSessionState {
  if (action.type === "reset") return initial(action.sessionId);
  if (action.sessionId !== state.sessionId) return state; // a late frame from the previous lecture
  if (action.type === "backfill") return { ...state, captions: upsertCaptions(state.captions, action.segments) };

  const m = action.message;
  switch (m.type) {
    case "session.ready":
      return { ...state, session: m.session, isReplay: m.isReplay, lastError: null };
    case "session.status":
      return { ...state, session: state.session && { ...state.session, status: m.status } };
    case "caption.interim":
    case "caption.final":
    case "caption.refined":
      // Captions flowing again means speech-to-text recovered.
      return {
        ...state,
        captions: applyCaptionMessage(state.captions, m),
        lastError: state.lastError?.code === "STT_ERROR" ? null : state.lastError,
      };
    case "slide.pointer":
      return { ...state, slidePointer: m.pointer };
    case "notes.status":
      return { ...state, notesStatus: m.status };
    case "error":
      return { ...state, lastError: { code: m.code, message: m.message } };
    default:
      return state;
  }
}

/** Adds or replaces an item by id in a cached list. */
const upsertById = <T extends { id: string }>(list: T[] | undefined, item: T) =>
  list?.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...(list ?? []), item];

/**
 * The live lecture socket while `sessionId` is set: ordered captions (refined in place, backfilled from the
 * transcript on every (re)connect), the slide pointer, notes progress and errors. Sign utterances and snapshots
 * go into the same query caches as their REST lists, de-duplicated by id.
 */
export function useSessionSocket(
  sessionId: string | null,
  options: { onMessage?: (message: SessionServerMessage) => void } = {},
) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, sessionId, initial);
  const [status, setStatus] = useState<SocketStatus>("CLOSED");
  const [socket, setSocket] = useState<TypedSocket<SessionClientMessage> | null>(null);

  const handleMessage = useEffectEvent((id: string, message: SessionServerMessage) => {
    dispatch({ type: "message", sessionId: id, message });
    options.onMessage?.(message);

    switch (message.type) {
      case "session.ready":
        api
          .getTranscript(id)
          .then(({ data }) => dispatch({ type: "backfill", sessionId: id, segments: data }))
          .catch((error) => console.warn("[session] transcript backfill failed", error));
        return;
      case "sign.utterance":
        queryClient.setQueryData<SignUtterance[]>(keys.utterances(id), (list) => upsertById(list, message.utterance));
        return;
      case "snapshot.captured":
        queryClient.setQueryData<Snapshot[]>(keys.snapshots(id), (list) => upsertById(list, message.snapshot));
        return;
      case "session.status":
      case "notes.status":
        void queryClient.invalidateQueries({ queryKey: keys.sessions.all });
        void queryClient.invalidateQueries({ queryKey: keys.notes(id) });
        return;
    }
  });

  useEffect(() => {
    dispatch({ type: "reset", sessionId });
    if (!sessionId) return;
    const s = connectSessionSocket(SERVER_WS_URL, sessionId, { onMessage: (m) => handleMessage(sessionId, m), onStatus: setStatus });
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
      setStatus("CLOSED");
    };
  }, [sessionId]);

  return {
    ...state,
    status,
    /** The raw socket, for @sightline/live-client helpers like `streamMicToSession`. */
    socket,
    send: (message: SessionClientMessage) => socket?.send(message),
  };
}

export type SessionSocket = ReturnType<typeof useSessionSocket>;
