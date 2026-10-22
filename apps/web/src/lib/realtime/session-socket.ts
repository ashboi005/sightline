import { MOCK_MODE } from "@/lib/api";
import { mockSessionSocket } from "@/mocks/realtime/session";
import type { SessionClientMessage, SessionServerMessage } from "@/types/realtime";

import { createSocket, type SocketHandlers } from "./socket";

const WS_URL = (process.env.NEXT_PUBLIC_SERVER_WS_URL || "ws://localhost:3000").replace(/\/$/, "");

/**
 * Live lecture socket. Open it after POST /api/sessions/:id/start. The session cookie authenticates the upgrade.
 * Mic audio goes up as binary frames after an `audio.start`; use `streamMicToSession` from @sightline/live-client.
 */
export function connectSessionSocket(sessionId: string, handlers: SocketHandlers<SessionServerMessage>) {
  if (MOCK_MODE) return mockSessionSocket(sessionId, handlers);
  return createSocket<SessionServerMessage, SessionClientMessage>(
    `${WS_URL}/ws/sessions/${encodeURIComponent(sessionId)}`,
    handlers,
  );
}
