/**
 * Ready-made clients for the web app (Sahil). Framework-agnostic — wrap them in React hooks/stores.
 *
 *   import { createSightlineApi, connectSessionSocket, connectGazeBridge, connectSignService } from "@sightline/contracts/client";
 */
import { buildPath } from "../api";
import { GAZE_BRIDGE_PROTOCOL_VERSION, GazeBridgeMessage, type GazeBridgeCommand } from "../protocols/gaze-bridge";
import { SESSION_SOCKET_PATH, SessionServerMessage, type SessionClientMessage } from "../protocols/session-socket";
import { SignServiceMessage, type SignServiceCommand } from "../protocols/sign-service";
import { createTypedSocket, type SocketStatus } from "./socket";

export { ApiRequestError, createSightlineApi, type SightlineApi } from "./http";
export { createTypedSocket, type SocketStatus, type TypedSocket } from "./socket";

type Handlers<M> = { onMessage: (message: M) => void; onStatus?: (status: SocketStatus) => void };

/** Server session socket. Binary `sendBinary` = mic PCM after an `audio.start`. */
export function connectSessionSocket(
  wsBaseUrl: string,
  sessionId: string,
  handlers: Handlers<SessionServerMessage>,
) {
  return createTypedSocket<typeof SessionServerMessage, SessionClientMessage>({
    url: `${wsBaseUrl.replace(/\/$/, "")}${buildPath(SESSION_SOCKET_PATH, { sessionId })}`,
    incoming: SessionServerMessage,
    ...handlers,
  });
}

/** Local gaze bridge (or `bun run mock:gaze`). Sends `hello` on every connect. */
export function connectGazeBridge(url: string, handlers: Handlers<GazeBridgeMessage>) {
  const socket = createTypedSocket<typeof GazeBridgeMessage, GazeBridgeCommand>({
    url,
    incoming: GazeBridgeMessage,
    ...handlers,
    onOpen: () => socket.send({ type: "hello", client: "sightline-web", protocolVersion: GAZE_BRIDGE_PROTOCOL_VERSION }),
  });
  return socket;
}

/** Harnoor's sign service (or `bun run mock:sign`). Send `stream.start`, then `frame`s. */
export function connectSignService(url: string, handlers: Handlers<SignServiceMessage> & { onOpen?: () => void }) {
  return createTypedSocket<typeof SignServiceMessage, SignServiceCommand>({
    url,
    incoming: SignServiceMessage,
    ...handlers,
  });
}
