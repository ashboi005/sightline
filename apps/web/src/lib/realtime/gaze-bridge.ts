import { MOCK_MODE } from "@/lib/api";
import { mockGazeBridge } from "@/mocks/realtime/gaze";
import type { GazeBridgeCommand, GazeBridgeMessage } from "@/types/realtime";

import { createSocket, type SocketHandlers } from "./socket";

const GAZE_BRIDGE_URL = process.env.NEXT_PUBLIC_GAZE_BRIDGE_URL || "ws://localhost:7777";
const PROTOCOL_VERSION = "1";

/** The local eye-tracker daemon on the student's laptop. Says `hello` on every (re)connect, as the bridge expects. */
export function connectGazeBridge(handlers: SocketHandlers<GazeBridgeMessage>) {
  if (MOCK_MODE) return mockGazeBridge(handlers);
  const socket = createSocket<GazeBridgeMessage, GazeBridgeCommand>(GAZE_BRIDGE_URL, {
    ...handlers,
    onOpen: () => socket.send({ type: "hello", client: "sightline-web", protocolVersion: PROTOCOL_VERSION }),
  });
  return socket;
}
