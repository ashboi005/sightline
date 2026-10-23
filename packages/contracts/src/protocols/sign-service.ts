/**
 * Sign service protocol — web app ↔ Harnoor's recogniser.   URL: ws://localhost:7788/ws (NEXT_PUBLIC_SIGN_SERVICE_URL)
 *
 * The web app streams webcam frames; the service streams back recognised gloss tokens and tells the
 * web app when a phrase has ended. Sentence building + speech happen on the server, NOT here.
 * All frames are JSON text. Python implementers: see json-schema/sign-service.*.json.
 */
import { z } from "zod";

import { Confidence, SocketError, Timestamp } from "../domain/common";
import { SignSource, SignToken } from "../domain/sign";

export const SIGN_SERVICE_DEFAULT_URL = "ws://localhost:7788/ws";
export const SIGN_SERVICE_PROTOCOL_VERSION = "1";

// ---------------------------------------------------------------------------
// Web → service
// ---------------------------------------------------------------------------

export const SignServiceCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stream.start"),
    protocolVersion: z.string(),
    source: SignSource,
    /** Frames per second the web app will send (recommended 10–15). */
    fps: z.number().int().min(1).max(30),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /** One webcam frame as a base64 JPEG (no data: prefix). Mirror NOT applied. */
  z.object({
    type: z.literal("frame"),
    seq: z.number().int().nonnegative(),
    image: z.string(),
    ts: Timestamp,
  }),
  z.object({ type: z.literal("stream.stop") }),
  /** Discard the in-progress phrase (student pressed "clear"). */
  z.object({ type: z.literal("phrase.reset") }),
]);
export type SignServiceCommand = z.infer<typeof SignServiceCommand>;

// ---------------------------------------------------------------------------
// Service → web
// ---------------------------------------------------------------------------

export const SignServiceMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("service.ready"),
    protocolVersion: z.string(),
    model: z.string(),
    /** Finite supported lexical labels plus spelling alphabet; composed fingerspelled words are not enumerated. */
    vocabulary: z.array(z.string()),
    ts: Timestamp,
  }),
  /** Lightweight per-frame status so the UI can show "hands detected". Max ~5 Hz. */
  z.object({
    type: z.literal("hands.status"),
    handsDetected: z.number().int().min(0).max(2),
    ts: Timestamp,
  }),
  /** Best current guess while a sign is in progress. May be replaced; never send it to the server. */
  z.object({
    type: z.literal("sign.partial"),
    gloss: z.string(),
    /** Stable raw spelling prefix; the remaining gloss suffix is still tentative. */
    acceptedGloss: z.string().optional(),
    confidence: Confidence,
    ts: Timestamp,
  }),
  /** A committed sign. Append to the current phrase. */
  z.object({ type: z.literal("sign.token"), token: SignToken, ts: Timestamp }),
  /**
   * The signer paused (hands down ~1 s) — a recognition segment is complete.
   * The web app preserves its editable draft; manual Enter/Send POSTs the sentence's
   * tokens to /api/sessions/:id/sign/utterances to get a sentence + audio.
   */
  z.object({
    type: z.literal("phrase.end"),
    tokenIds: z.array(z.string()),
    ts: Timestamp,
  }),
  SocketError,
]);
export type SignServiceMessage = z.infer<typeof SignServiceMessage>;
