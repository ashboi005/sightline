/**
 * OWNER: Ashwath. When to auto-capture a board snapshot (DOM-free, unit-tested).
 *  - BoardDwellTrigger: the student kept looking at the board → probably something worth saving.
 *  - VisualChangeDetector: the board changed (new drawing/writing) and then stopped changing → save the result.
 *  - SnapshotGate: global cooldown so automatic triggers never spam the notes.
 * Speech cues come from the server as `snapshot.request`; manual captures bypass the gate.
 */
import type { GazeZone } from "@sightline/contracts";

export class BoardDwellTrigger {
  private since: number | null = null;
  private fired = false;

  constructor(private readonly dwellMs = 4000) {}

  /** Feed every gaze zone; returns true once per board visit after `dwellMs`. Blinks (UNKNOWN) don't reset it. */
  update(zone: GazeZone, now: number): boolean {
    if (zone === "UNKNOWN") return false;
    if (zone !== "BOARD") {
      this.since = null;
      this.fired = false;
      return false;
    }
    this.since ??= now;
    if (!this.fired && now - this.since >= this.dwellMs) {
      this.fired = true;
      return true;
    }
    return false;
  }
}

/** Mean absolute difference of two equal-size 8-bit grayscale thumbnails, 0..1. */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / (a.length * 255);
}

export type VisualChangeOptions = {
  /** Difference vs the last saved board that counts as "new content" (0..1). */
  changeThreshold?: number;
  /** Frame-to-frame difference below which the board counts as settled. */
  stableThreshold?: number;
  /** How long it must stay settled before capturing. */
  stableMs?: number;
};

export class VisualChangeDetector {
  private reference: Uint8Array | null = null;
  private previous: Uint8Array | null = null;
  private stableSince: number | null = null;
  private readonly opts: Required<VisualChangeOptions>;

  constructor(options: VisualChangeOptions = {}) {
    this.opts = { changeThreshold: 0.06, stableThreshold: 0.015, stableMs: 1500, ...options };
  }

  /** Feed thumbnails (~2 fps). Returns true when new content appeared and has settled. */
  feed(thumb: Uint8Array, now: number): boolean {
    if (!this.reference) {
      this.reference = thumb;
      this.previous = thumb;
      return false;
    }
    const moving = this.previous ? frameDifference(thumb, this.previous) : 1;
    this.previous = thumb;
    if (moving > this.opts.stableThreshold) {
      this.stableSince = null; // someone is still drawing / walking in front
      return false;
    }
    this.stableSince ??= now;
    if (now - this.stableSince < this.opts.stableMs) return false;
    if (frameDifference(thumb, this.reference) < this.opts.changeThreshold) return false;
    this.reference = thumb;
    this.stableSince = null;
    return true;
  }
}

export class SnapshotGate {
  private last = -Infinity;

  constructor(private readonly cooldownMs = 15_000) {}

  allow(now: number): boolean {
    if (now - this.last < this.cooldownMs) return false;
    this.last = now;
    return true;
  }
}
