/**
 * OWNER: Tushar. Session WebSocket — docs/contracts/realtime-ws.md, schemas in protocols/session-socket.ts.
 */
import { SESSION_SOCKET_PATH, SessionClientMessage, type SessionServerMessage } from "@sightline/contracts";
import { Elysia } from "elysia";

import { notFound } from "../../../lib/errors";
import type { UserResolver } from "../auth";
import type { PlatformService } from "../platform-service";
import type { SessionStore } from "../store/types";
import type { SessionHub } from "./hub";
import type { LiveCaptions } from "./live-captions";

const toBytes = (message: unknown): Uint8Array | null => {
  if (message instanceof Uint8Array) return message;
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  return null;
};

export const sessionSocket = (deps: {
  platform: PlatformService;
  store: SessionStore;
  hub: SessionHub;
  live: LiveCaptions;
  resolveUser: UserResolver;
}) => {
  const { store, hub, live, platform } = deps;
  const unsubscribers = new Map<string, () => void>();
  /** Socket id → session id, for sockets that are currently streaming mic audio. */
  const audioOwners = new Map<string, string>();

  return new Elysia().ws(SESSION_SOCKET_PATH, {
    async beforeHandle({ request, params }) {
      const user = await deps.resolveUser(request);
      if (!(await store.getSession(user.id, params.sessionId))) throw notFound("Session");
    },

    async open(ws) {
      const { sessionId } = ws.data.params;
      const send = (msg: SessionServerMessage) => ws.send(JSON.stringify(msg));
      unsubscribers.set(ws.id, hub.subscribe(sessionId, { id: ws.id, send: (data) => ws.send(data) }));

      const session = await store.findSession(sessionId);
      if (!session) {
        ws.close();
        return;
      }
      send({ type: "session.ready", session, isReplay: live.isReplay, ts: Date.now() });
    },

    // NOTE: Elysia sends whatever a ws handler returns back to the client — handlers must return nothing.
    async message(ws, raw) {
      const { sessionId } = ws.data.params;
      const send = (msg: SessionServerMessage) => ws.send(JSON.stringify(msg));

      const bytes = toBytes(raw);
      if (bytes) {
        if (audioOwners.get(ws.id) === sessionId) live.pushAudio(sessionId, bytes);
        return;
      }

      let parsed: unknown = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          send({ type: "error", code: "BAD_JSON", message: "Text frames must be JSON", ts: Date.now() });
          return;
        }
      }
      const result = SessionClientMessage.safeParse(parsed);
      if (!result.success) {
        send({ type: "error", code: "VALIDATION_ERROR", message: result.error.message, ts: Date.now() });
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case "ping":
          send({ type: "pong", ts: Date.now() });
          return;
        case "gaze.transition":
          await platform.recordGaze(sessionId, msg.transition);
          return;
        case "audio.start": {
          if (live.isReplay) return; // mock speech: captions are already being replayed
          const session = await store.findSession(sessionId);
          if (session?.status !== "LIVE") {
            send({ type: "error", code: "NOT_LIVE", message: "Start the session first", ts: Date.now() });
            return;
          }
          audioOwners.set(ws.id, sessionId);
          await live.start(sessionId, session.startedAt ?? Date.now(), msg.format);
          return;
        }
        case "audio.stop":
          if (audioOwners.get(ws.id) === sessionId) {
            audioOwners.delete(ws.id);
            await live.stop(sessionId);
          }
          return;
      }
    },

    async close(ws) {
      unsubscribers.get(ws.id)?.();
      unsubscribers.delete(ws.id);
      const sessionId = audioOwners.get(ws.id);
      if (sessionId) {
        audioOwners.delete(ws.id);
        await live.stop(sessionId);
      }
    },
  });
};
