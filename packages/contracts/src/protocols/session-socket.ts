/**
 * Session WebSocket — web app ↔ server.   URL: `${SERVER_WS_URL}/ws/sessions/:sessionId`
 *
 * - Text frames are JSON matching `SessionClientMessage` / `SessionServerMessage`.
 * - Binary frames (client → server only) are raw microphone audio, in the format announced by `audio.start`.
 * - Auth: the better-auth session cookie is sent with the upgrade request (MOCK_AUTH skips the check).
 */
import { z } from "zod";

import { CaptionSegment } from "../domain/captions";
import { NotesId, OffsetMs, SegmentId, SocketError, Timestamp } from "../domain/common";
import { SlidePointer } from "../domain/context";
import { GazeTransition } from "../domain/gaze";
import { ProcessingStatus, Session, SessionStatus } from "../domain/session";
import { SignUtterance } from "../domain/sign";
import { Snapshot, SnapshotTrigger } from "../domain/snapshots";

export const SESSION_SOCKET_PATH = "/ws/sessions/:sessionId";

export const AudioFormat = z.object({
  /** Only LINEAR16 (16-bit signed little-endian PCM) is guaranteed; Deepgram accepts it natively. */
  encoding: z.literal("LINEAR16"),
  sampleRate: z.union([z.literal(16000), z.literal(48000)]),
  channels: z.literal(1),
});
export type AudioFormat = z.infer<typeof AudioFormat>;

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export const SessionClientMessage = z.discriminatedUnion("type", [
  /** Start streaming mic audio. Binary frames follow. In mock-speech mode audio is ignored and a lecture is replayed. */
  z.object({ type: z.literal("audio.start"), format: AudioFormat, ts: Timestamp }),
  z.object({ type: z.literal("audio.stop"), ts: Timestamp }),
  /** Forward every zone change received from the gaze bridge. */
  z.object({ type: z.literal("gaze.transition"), transition: GazeTransition, ts: Timestamp }),
  z.object({ type: z.literal("ping"), ts: Timestamp }),
]);
export type SessionClientMessage = z.infer<typeof SessionClientMessage>;

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const SessionServerMessage = z.discriminatedUnion("type", [
  /** First message after connect. `isReplay` = captions come from the mock lecture, not the mic. */
  z.object({
    type: z.literal("session.ready"),
    session: Session,
    isReplay: z.boolean(),
    ts: Timestamp,
  }),
  z.object({ type: z.literal("session.status"), status: SessionStatus, ts: Timestamp }),
  /** Words still being spoken. Replace the interim line in place; it has no stable content yet. */
  z.object({
    type: z.literal("caption.interim"),
    segmentId: SegmentId,
    seq: z.number().int().nonnegative(),
    text: z.string(),
    startMs: OffsetMs,
    ts: Timestamp,
  }),
  /** STT finished this segment (raw text, single text part). Append it. */
  z.object({ type: z.literal("caption.final"), segment: CaptionSegment, ts: Timestamp }),
  /** Corrected version of an already-final segment. Replace by `segment.id`. May arrive out of order. */
  z.object({ type: z.literal("caption.refined"), segment: CaptionSegment, ts: Timestamp }),
  /** P1 — flip the slide preview / highlight a bullet. */
  z.object({ type: z.literal("slide.pointer"), pointer: SlidePointer, ts: Timestamp }),
  /** A sign utterance was created (by this client or another tab) — show it and play audio if SELF. */
  z.object({ type: z.literal("sign.utterance"), utterance: SignUtterance, ts: Timestamp }),
  /** The server heard a visual cue: grab the current scene frame and POST it to /snapshots with this trigger. */
  z.object({
    type: z.literal("snapshot.request"),
    trigger: SnapshotTrigger,
    reason: z.string(),
    segmentId: SegmentId.nullable(),
    ts: Timestamp,
  }),
  /** A snapshot was stored (sent again when its description arrives). */
  z.object({ type: z.literal("snapshot.captured"), snapshot: Snapshot, ts: Timestamp }),
  z.object({
    type: z.literal("notes.status"),
    status: ProcessingStatus,
    notesId: NotesId.nullable(),
    ts: Timestamp,
  }),
  z.object({ type: z.literal("pong"), ts: Timestamp }),
  SocketError,
]);
export type SessionServerMessage = z.infer<typeof SessionServerMessage>;
export type SessionServerMessageType = SessionServerMessage["type"];
