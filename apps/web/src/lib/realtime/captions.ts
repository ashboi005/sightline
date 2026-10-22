import type { CaptionSegment, CaptionStatus, SessionServerMessage } from "@sightline/contracts";

export type InterimCaption = { segmentId: string; seq: number; text: string; startMs: number };

/** Captions so far, ordered by `seq`, plus the line still being spoken. */
export type CaptionState = { segments: CaptionSegment[]; interim: InterimCaption | null };

export const emptyCaptions: CaptionState = { segments: [], interim: null };

const rank: Record<CaptionStatus, number> = { INTERIM: 0, FINAL: 1, REFINED: 2 };

/**
 * Adds or replaces segments by id. A segment never goes backwards (REFINED beats FINAL), so a late final after a
 * refine, or a transcript backfill after a reconnect, can't undo a correction.
 */
export function upsertCaptions(state: CaptionState, incoming: CaptionSegment[]): CaptionState {
  if (incoming.length === 0) return state;
  const byId = new Map(state.segments.map((s) => [s.id, s]));
  for (const segment of incoming) {
    const current = byId.get(segment.id);
    if (!current || rank[segment.status] >= rank[current.status]) byId.set(segment.id, segment);
  }
  const interim = state.interim && byId.has(state.interim.segmentId) ? null : state.interim;
  return { segments: [...byId.values()].sort((a, b) => a.seq - b.seq), interim };
}

/** Applies the caption messages from the session socket; returns `state` unchanged for anything else. */
export function applyCaptionMessage(state: CaptionState, message: SessionServerMessage): CaptionState {
  switch (message.type) {
    case "caption.interim":
      return { ...state, interim: { segmentId: message.segmentId, seq: message.seq, text: message.text, startMs: message.startMs } };
    case "caption.final":
    case "caption.refined":
      return upsertCaptions(state, [message.segment]);
    default:
      return state;
  }
}
