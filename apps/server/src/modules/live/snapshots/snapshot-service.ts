/**
 * OWNER: Ashwath. Stores a captured board/diagram frame, links it to the captions around it, broadcasts it, and
 * asks the vision model for a description (async). The notes job (Tushar) reads them via SessionStore.listSnapshots.
 */
import type { CaptionSegment, Snapshot, SnapshotTrigger } from "@sightline/contracts";

import { AppError, notFound } from "../../../lib/errors";
import { newId } from "../../../lib/ids";
import type { AssetStore, SessionEvents, SessionStore } from "../../../shared/ports";
import type { VisionDescriber } from "./vision";

/** Captions from 15 s before to 5 s after the capture give the snapshot its context. */
const CONTEXT_BEFORE_MS = 15_000;
const CONTEXT_AFTER_MS = 5_000;

export class SnapshotService {
  constructor(
    private readonly deps: {
      store: SessionStore;
      assets: AssetStore;
      events: SessionEvents;
      vision: VisionDescriber;
      assetUrl: (assetId: string) => string;
    },
  ) {}

  async create(
    sessionId: string,
    image: { bytes: Uint8Array; mimeType: string },
    fields: { trigger: SnapshotTrigger; reason: string; capturedAt?: number },
  ): Promise<Snapshot> {
    const { store, assets, events } = this.deps;
    const session = await store.findSession(sessionId);
    if (!session) throw notFound("Session");
    if (!session.startedAt) throw new AppError("CONFLICT", "Start the session before capturing snapshots");

    const capturedAt = fields.capturedAt ?? Date.now();
    const atMs = Math.max(0, capturedAt - session.startedAt);
    const segments = await store.listSegments(sessionId);
    const nearby = nearbySegments(segments, atMs);

    const assetId = await assets.put(image.mimeType, image.bytes, sessionId);
    const snapshot: Snapshot = {
      id: newId("snp"),
      sessionId,
      imageUrl: this.deps.assetUrl(assetId),
      trigger: fields.trigger,
      reason: fields.reason || defaultReason(fields.trigger),
      capturedAt,
      atMs,
      segmentIds: nearby.map((s) => s.id),
      description: null,
    };
    await store.upsertSnapshot(snapshot);
    events.publish(sessionId, { type: "snapshot.captured", snapshot, ts: Date.now() });

    void this.describe(snapshot, image, nearby.map((s) => s.text).join(" "));
    return snapshot;
  }

  async list(sessionId: string): Promise<Snapshot[]> {
    return this.deps.store.listSnapshots(sessionId);
  }

  private async describe(snapshot: Snapshot, image: { bytes: Uint8Array; mimeType: string }, context: string) {
    const description = await this.deps.vision.describe(image.bytes, image.mimeType, context.slice(-600));
    if (!description) return;
    const described = { ...snapshot, description };
    await this.deps.store.upsertSnapshot(described).catch(() => {});
    this.deps.events.publish(snapshot.sessionId, { type: "snapshot.captured", snapshot: described, ts: Date.now() });
  }
}

export function nearbySegments(segments: CaptionSegment[], atMs: number): CaptionSegment[] {
  return segments.filter((s) => s.endMs >= atMs - CONTEXT_BEFORE_MS && s.startMs <= atMs + CONTEXT_AFTER_MS);
}

const defaultReason = (trigger: SnapshotTrigger) =>
  ({
    SPEECH_CUE: "Teacher referred to the board",
    BOARD_DWELL: "You looked at the board for a while",
    VISUAL_CHANGE: "New content appeared on the board",
    POINTING: "Teacher pointed at something",
    MANUAL: "Saved by you",
  })[trigger];
