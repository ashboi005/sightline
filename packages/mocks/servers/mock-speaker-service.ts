/**
 * Mock speaker service: stands in for apps/speaker-service (Python + PyTorch) during UI work.
 * Speaks protocols/speaker-service.ts: same /live socket, same binary packets, same replies.
 *
 *   bun run mock:speaker                 (from repo root)
 *   SPEAKER_SERVICE_PORT=7799 bun packages/mocks/servers/mock-speaker-service.ts
 *
 * Behaviour: frames → two fixed faces ("face_left", "face_right"). After a `target`, every PCM packet comes back
 * as `audio` after ~600 ms, attenuated and tinted (so you can hear it's "processed"). It does NOT separate voices.
 */
import {
  SPEAKER_PACKET_HEADER_BYTES,
  SPEAKER_SERVICE_PROTOCOL_VERSION,
  SpeakerPacketKind,
  SpeakerServiceCommand,
  type FaceTrack,
  type SpeakerServiceMessage,
} from "@sightline/contracts";
import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.SPEAKER_SERVICE_PORT ?? 7799);
const LATENCY_MS = 600;
const FACES: { id: string; box: [number, number, number, number] }[] = [
  { id: "face_left", box: [0.18, 0.43, 0.15, 0.34] },
  { id: "face_right", box: [0.68, 0.39, 0.17, 0.35] },
];

type State = { configured: boolean; generation: number; target: string | null; lastFaces: number; accepted: number };
const states = new Map<ServerWebSocket<unknown>, State>();

const send = (ws: ServerWebSocket<unknown>, msg: SpeakerServiceMessage) => ws.send(JSON.stringify(msg));
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function onPacket(ws: ServerWebSocket<unknown>, s: State, data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(...data.subarray(0, 4));
  if (magic !== "GSP2") throw new Error("Streaming protocol version mismatch; reload the matching frontend");
  const kind = view.getUint8(4);
  const generation = view.getUint32(8, true);
  const sampleStart = Number(view.getBigUint64(12, true));
  const captureTime = view.getFloat64(20, true);
  const length = view.getUint32(28, true);
  if (length !== data.byteLength - SPEAKER_PACKET_HEADER_BYTES) throw new Error("Malformed streaming packet header");
  if (generation !== s.generation) return;

  if (kind === SpeakerPacketKind.FRAME) {
    const now = Date.now();
    if (now - s.lastFaces >= 180) {
      s.lastFaces = now;
      const tracks: FaceTrack[] = FACES.map((f) => ({
        id: f.id,
        manual: false,
        observations: [{ timestamp: sampleStart / 16000, box: f.box }],
      }));
      send(ws, { type: "faces", generation: s.generation, tracks });
    }
    return;
  }
  if (kind !== SpeakerPacketKind.PCM || !s.target) return;

  const payload = data.slice(SPEAKER_PACKET_HEADER_BYTES);
  const pcm = new DataView(payload.buffer);
  const out = new Uint8Array(payload.byteLength);
  const outView = new DataView(out.buffer);
  const tilt = s.target === "face_left" ? 0.5 : 0.7;
  for (let i = 0; i < payload.byteLength / 4; i++) outView.setFloat32(i * 4, pcm.getFloat32(i * 4, true) * tilt, true);
  const sampleCount = payload.byteLength / 4;
  s.accepted = sampleStart + sampleCount;
  const reply: SpeakerServiceMessage = {
    type: "audio",
    generation: s.generation,
    start_sample: sampleStart,
    sample_count: sampleCount,
    sample_rate: 16000,
    capture_spans: [{ start_sample: sampleStart, end_sample: sampleStart + sampleCount, capture_time: captureTime }],
    device: "mock",
    timings: { inference: LATENCY_MS / 1000 },
    queued_windows: 0,
    pcm: toBase64(out),
  };
  setTimeout(() => states.has(ws) && states.get(ws)!.generation === reply.generation && send(ws, reply), LATENCY_MS);
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(
        {
          ready: true,
          model_state: "ready",
          engine: "mock",
          device: "mock",
          error: null,
          live: true,
          streaming_ready: true,
          streaming_error: null,
          noise_processor: "off",
        },
        { headers: { "access-control-allow-origin": "*" } },
      );
    }
    if (url.pathname === "/live" && server.upgrade(req)) return;
    return new Response("Sightline mock speaker service — WebSocket at /live, GET /health", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 512 * 1024,
    open(ws) {
      states.set(ws, { configured: false, generation: 0, target: null, lastFaces: 0, accepted: 0 });
      console.log("[mock-speaker] client connected");
    },
    close(ws) {
      states.delete(ws);
      console.log("[mock-speaker] client disconnected");
    },
    message(ws, raw) {
      const s = states.get(ws);
      if (!s) return;
      try {
        if (typeof raw !== "string") {
          if (!s.configured) throw new Error("Send configure first");
          onPacket(ws, s, raw instanceof Uint8Array ? raw : new Uint8Array(raw));
          return;
        }
        const cmd = SpeakerServiceCommand.parse(JSON.parse(raw));
        switch (cmd.type) {
          case "configure":
            s.configured = true;
            send(ws, {
              type: "ready",
              generation: 0,
              device: "mock",
              protocol_version: SPEAKER_SERVICE_PROTOCOL_VERSION,
              analysis_mode: "available",
              engine: "mock",
              minimum_samples: 1920,
              history_samples: 6400,
              maximum_input_samples: 128000,
              noise_processor: "off",
              warm_timings: [LATENCY_MS / 1000],
            });
            break;
          case "target":
            if (cmd.generation <= s.generation) break;
            if (cmd.target_id && !FACES.some((f) => f.id === cmd.target_id)) throw new Error("Selected face expired; reacquire it");
            s.generation = cmd.generation;
            s.target = cmd.target_id;
            send(ws, { type: "selected", generation: s.generation, target_id: s.target });
            console.log(`[mock-speaker] target → ${s.target} (gen ${s.generation})`);
            break;
          case "end":
            setTimeout(() => send(ws, { type: "drained", generation: s.generation, source_end_sample: cmd.source_end_sample }), LATENCY_MS);
            break;
          case "stop":
            ws.close();
            break;
          default:
            break; // pause / resume / heartbeat / region: accepted, no-op in the mock
        }
      } catch (error) {
        send(ws, {
          type: "error",
          code: "invalid_live_input",
          message: error instanceof Error ? error.message : String(error),
          generation: s.generation,
        });
      }
    },
  },
});

console.log(`[mock-speaker] listening on ws://127.0.0.1:${PORT}/live (no real separation — UI work only)`);
