import { z } from "zod";

import { Confidence, SessionId, SignTokenId, Timestamp, UtteranceId } from "./common";

/** SELF = the student is signing. PEER = someone else is signing at the camera. */
export const SignSource = z.enum(["SELF", "PEER"]);
export type SignSource = z.infer<typeof SignSource>;

/**
 * One recognised sign. `gloss` is the UPPERCASE sign label (ASL gloss convention), e.g. "QUESTION",
 * "REPEAT", "FORMULA". Fingerspelled words use kind FINGERSPELL with the letters as gloss ("OHM").
 */
export const SignToken = z.object({
  id: SignTokenId,
  gloss: z.string().min(1),
  kind: z.enum(["SIGN", "FINGERSPELL", "NUMBER"]),
  confidence: Confidence,
  ts: Timestamp,
});
export type SignToken = z.infer<typeof SignToken>;

/** POST /api/sessions/:id/sign/utterances */
export const CreateSignUtteranceInput = z.object({
  tokens: z.array(SignToken).min(1).max(64),
  source: SignSource,
  /** Generate TTS audio so the laptop speaks the sentence aloud. */
  speak: z.boolean().default(true),
});
export type CreateSignUtteranceInput = z.infer<typeof CreateSignUtteranceInput>;

/** A full signed phrase turned into a natural sentence (+ optional speech audio). */
export const SignUtterance = z.object({
  id: UtteranceId,
  sessionId: SessionId,
  source: SignSource,
  gloss: z.array(z.string()),
  text: z.string(),
  alternatives: z.array(z.string()),
  /** Absolute or server-relative URL of an audio file (audio/mpeg or audio/wav). Null when speak=false. */
  audioUrl: z.string().nullable(),
  confidence: Confidence,
  createdAt: Timestamp,
});
export type SignUtterance = z.infer<typeof SignUtterance>;
