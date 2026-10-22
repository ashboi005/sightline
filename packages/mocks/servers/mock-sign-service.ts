/**
 * Mock sign service — stands in for Harnoor's recogniser. Speaks protocols/sign-service.ts exactly.
 *
 *   bun run mock:sign                    (from repo root)
 *   SIGN_SERVICE_PORT=7788 bun packages/mocks/servers/mock-sign-service.ts
 *   MOCK_SIGN_AUTO=1 …                   (recognise on a timer even if no frames arrive — no webcam needed)
 *
 * While frames are streaming it "recognises" the phrases in fixtures/sign.phrases.json one after another:
 * idle → sign.partial / sign.token per sign (~1.1 s each) → pause → phrase.end → idle.
 */
import {
  SIGN_SERVICE_PROTOCOL_VERSION,
  SignServiceCommand,
  type SignServiceMessage,
  type SignSource,
} from "@sightline/contracts";
import type { ServerWebSocket } from "bun";

import { fixtures, mockId } from "../src/index";

const PORT = Number(process.env.SIGN_SERVICE_PORT ?? 7788);
const AUTO = process.env.MOCK_SIGN_AUTO === "1";
const SIGN_MS = 1100;
const PAUSE_MS = 1000;
const IDLE_MS = 2500;

type Phase = "IDLE" | "SIGNING" | "PAUSE";

type ClientState = {
  streaming: boolean;
  source: SignSource;
  phase: Phase;
  phaseStartedAt: number;
  phraseCursor: number;
  tokenIndex: number;
  partialSent: boolean;
  tokenIds: string[];
  frames: number;
  lastHandsAt: number;
};

const states = new Map<ServerWebSocket<unknown>, ClientState>();
const send = (ws: ServerWebSocket<unknown>, msg: SignServiceMessage) => ws.send(JSON.stringify(msg));

function phrasesFor(source: SignSource) {
  const matching = fixtures.sign.phrases.filter((p) => p.source === source);
  return matching.length > 0 ? matching : fixtures.sign.phrases;
}

function tick(ws: ServerWebSocket<unknown>, s: ClientState) {
  if (!s.streaming) return;
  const now = Date.now();
  const elapsed = now - s.phaseStartedAt;
  const phrases = phrasesFor(s.source);
  const phrase = phrases[s.phraseCursor % phrases.length]!;

  if (now - s.lastHandsAt > 200) {
    s.lastHandsAt = now;
    send(ws, { type: "hands.status", handsDetected: s.phase === "IDLE" ? 0 : 2, ts: now });
  }

  if (s.phase === "IDLE" && elapsed >= IDLE_MS) {
    Object.assign(s, { phase: "SIGNING", phaseStartedAt: now, tokenIndex: 0, partialSent: false, tokenIds: [] });
    return;
  }

  if (s.phase === "SIGNING") {
    const token = phrase.tokens[s.tokenIndex];
    if (!token) {
      Object.assign(s, { phase: "PAUSE", phaseStartedAt: now });
      return;
    }
    if (!s.partialSent && elapsed >= SIGN_MS / 2) {
      s.partialSent = true;
      send(ws, { type: "sign.partial", gloss: token.gloss, confidence: token.confidence * 0.7, ts: now });
    }
    if (elapsed >= SIGN_MS) {
      const id = mockId("tok");
      s.tokenIds.push(id);
      send(ws, { type: "sign.token", token: { id, ...token, ts: now }, ts: now });
      console.log(`[mock-sign] token ${token.gloss}`);
      Object.assign(s, { phaseStartedAt: now, tokenIndex: s.tokenIndex + 1, partialSent: false });
    }
    return;
  }

  if (s.phase === "PAUSE" && elapsed >= PAUSE_MS) {
    send(ws, { type: "phrase.end", tokenIds: s.tokenIds, ts: now });
    console.log(`[mock-sign] phrase.end → expected sentence: "${phrase.text}"`);
    Object.assign(s, { phase: "IDLE", phaseStartedAt: now, phraseCursor: s.phraseCursor + 1, tokenIds: [] });
  }
}

const autoTimers = new Map<ServerWebSocket<unknown>, ReturnType<typeof setInterval>>();

Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Sightline mock sign service — connect via WebSocket at /ws", { status: 426 });
  },
  websocket: {
    maxPayloadLength: 4 * 1024 * 1024,
    open(ws) {
      states.set(ws, {
        streaming: false,
        source: "SELF",
        phase: "IDLE",
        phaseStartedAt: Date.now(),
        phraseCursor: 0,
        tokenIndex: 0,
        partialSent: false,
        tokenIds: [],
        frames: 0,
        lastHandsAt: 0,
      });
      send(ws, {
        type: "service.ready",
        protocolVersion: SIGN_SERVICE_PROTOCOL_VERSION,
        model: "mock-sign-v1",
        vocabulary: fixtures.sign.vocabulary,
        ts: Date.now(),
      });
      console.log("[mock-sign] client connected");
    },
    close(ws) {
      states.delete(ws);
      const timer = autoTimers.get(ws);
      if (timer) clearInterval(timer);
      autoTimers.delete(ws);
      console.log("[mock-sign] client disconnected");
    },
    message(ws, raw) {
      const s = states.get(ws);
      if (!s) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "error", code: "BAD_JSON", message: "Frames must be JSON", ts: Date.now() });
        return;
      }
      const result = SignServiceCommand.safeParse(parsed);
      if (!result.success) {
        send(ws, { type: "error", code: "VALIDATION_ERROR", message: result.error.message, ts: Date.now() });
        return;
      }
      const cmd = result.data;
      switch (cmd.type) {
        case "stream.start":
          Object.assign(s, { streaming: true, source: cmd.source, phase: "IDLE", phaseStartedAt: Date.now() });
          console.log(`[mock-sign] stream.start source=${cmd.source} ${cmd.width}x${cmd.height}@${cmd.fps}`);
          if (AUTO && !autoTimers.has(ws)) autoTimers.set(ws, setInterval(() => tick(ws, s), 100));
          break;
        case "frame":
          s.frames++;
          if (!AUTO) tick(ws, s);
          break;
        case "stream.stop":
          s.streaming = false;
          console.log(`[mock-sign] stream.stop after ${s.frames} frames`);
          break;
        case "phrase.reset":
          Object.assign(s, { phase: "IDLE", phaseStartedAt: Date.now(), tokenIds: [], tokenIndex: 0 });
          break;
      }
    },
  },
});

console.log(`[mock-sign] listening on ws://localhost:${PORT}/ws ${AUTO ? "(AUTO: no frames needed)" : "(send frames to recognise)"}`);
