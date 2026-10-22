/**
 * Ready-made clients for the web app (Sahil). Framework-agnostic — wrap them in React hooks/stores.
 *
 *   import { createSightlineApi, connectSessionSocket, connectGazeBridge, connectSignService } from "@sightline/contracts/client";
 */
import { buildPath } from "../api";
import { GAZE_BRIDGE_PROTOCOL_VERSION, GazeBridgeMessage, type GazeBridgeCommand } from "../protocols/gaze-bridge";
import { SESSION_SOCKET_PATH, SessionServerMessage, type SessionClientMessage } from "../protocols/session-socket";
import { SignServiceMessage, type SignServiceCommand } from "../protocols/sign-service";
import {
  SPEAKER_SAMPLE_RATE,
  SPEAKER_SERVICE_PROTOCOL_VERSION,
  SpeakerServiceMessage,
  type SpeakerServiceCommand,
} from "../protocols/speaker-service";
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

/**
 * Local look-to-hear speaker service (or `bun run mock:speaker`). Sends `configure` on every (re)connect;
 * then stream `encodeSpeakerPcm` / `encodeSpeakerPacket` binaries and `target` commands.
 */
export function connectSpeakerService(
  url: string,
  config: { source: "camera" | "network" | "replay"; videoOffsetMs: number },
  handlers: Handlers<SpeakerServiceMessage> & { onOpen?: () => void },
) {
  const socket = createTypedSocket<typeof SpeakerServiceMessage, SpeakerServiceCommand>({
    url,
    incoming: SpeakerServiceMessage,
    onMessage: handlers.onMessage,
    onStatus: handlers.onStatus,
    onOpen: () => {
      socket.send({
        type: "configure",
        protocol_version: SPEAKER_SERVICE_PROTOCOL_VERSION,
        sample_rate: SPEAKER_SAMPLE_RATE,
        audio: true,
        source: config.source,
        sync_verified: true,
        video_offset_ms: config.videoOffsetMs,
        client_time: performance.now() / 1000,
      });
      handlers.onOpen?.();
    },
  });
  return socket;
}
