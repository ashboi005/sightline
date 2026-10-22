"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useReducer, useState } from "react";

import { api } from "@/lib/api";
import { applyCaptionMessage, emptyCaptions, upsertCaptions, type CaptionState } from "@/lib/realtime/captions";
import { connectSessionSocket } from "@/lib/realtime/session-socket";
import type { Socket, SocketStatus } from "@/lib/realtime/socket";
import type { ProcessingStatus, Session } from "@/types";
import type {
  CaptionSegment,
  SessionClientMessage,
  SessionServerMessage,
  SlidePointer,
  SignUtterance,
  Snapshot,
} from "@/types/realtime";

import { sessionKeys } from "./use-sessions";

export type LiveSessionState = {
  session: Session | null;
  /** Captions come from a recorded lecture (mock speech), so the mic isn't needed. */
  isReplay: boolean;
  captions: CaptionState;
  slidePointer: SlidePointer | null;
  utterances: SignUtterance[];
  snapshots: Snapshot[];
  notesStatus: ProcessingStatus | null;
  lastError: { code: string; message: string } | null;
};

const initialState: LiveSessionState = {
  session: null,
  isReplay: false,
  captions: emptyCaptions,
  slidePointer: null,
  utterances: [],
  snapshots: [],
  notesStatus: null,
  lastError: null,
};

type Action = { type: "message"; message: SessionServerMessage } | { type: "backfill"; segments: CaptionSegment[] };

function reducer(state: LiveSessionState, action: Action): LiveSessionState {
  if (action.type === "backfill") return { ...state, captions: upsertCaptions(state.captions, action.segments) };

  const m = action.message;
  switch (m.type) {
    case "session.ready":
      return { ...state, session: m.session, isReplay: m.isReplay };
    case "session.status":
      return { ...state, session: state.session && { ...state.session, status: m.status } };
    case "caption.interim":
    case "caption.final":
    case "caption.refined":
      return { ...state, captions: applyCaptionMessage(state.captions, m) };
    case "slide.pointer":
      return { ...state, slidePointer: m.pointer };
    case "sign.utterance":
      return state.utterances.some((u) => u.id === m.utterance.id)
        ? state
        : { ...state, utterances: [...state.utterances, m.utterance] };
    case "snapshot.captured": // sent again with a description: replace by id
      return { ...state, snapshots: [...state.snapshots.filter((s) => s.id !== m.snapshot.id), m.snapshot] };
    case "notes.status":
      return { ...state, notesStatus: m.status };
    case "error":
      return { ...state, lastError: { code: m.code, message: m.message } };
    default: // pong; snapshot.request is handled through `onMessage`
      return state;
  }
}

/**
 * Connects to the live lecture socket while `sessionId` is set and keeps the lecture's live state: ordered
 * captions (refined in place), the slide pointer, sign utterances, snapshots and notes progress.
 *
 *   const live = useSessionSocket(sessionId, { onMessage: (m) => snapshots.onSessionMessage(m) });
 *   live.send({ type: "gaze.transition", transition, ts: Date.now() });
 *   streamMicToSession(live.socket!, mic);   // @sightline/live-client, when not a replay
 */
export function useSessionSocket(
  sessionId: string | null,
  options: { onMessage?: (message: SessionServerMessage) => void } = {},
) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [status, setStatus] = useState<SocketStatus>("CLOSED");
  const [socket, setSocket] = useState<Socket<SessionClientMessage> | null>(null);

  const handleMessage = useEffectEvent((message: SessionServerMessage) => {
    dispatch({ type: "message", message });
    options.onMessage?.(message);

    if (message.type === "session.ready" && sessionId) {
      // First connect or reconnect: fetch what we may have missed; upsert de-duplicates by segment id.
      api<{ data: CaptionSegment[] }>(`/api/sessions/${sessionId}/transcript`)
        .then(({ data }) => dispatch({ type: "backfill", segments: data }))
        .catch((error) => console.warn("[session] transcript backfill failed", error));
    }
    if (message.type === "session.status" || message.type === "notes.status") {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    }
  });

  useEffect(() => {
    if (!sessionId) return;
    const s = connectSessionSocket(sessionId, { onMessage: (m) => handleMessage(m), onStatus: setStatus });
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
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
