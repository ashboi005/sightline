import type { GazeZone } from "@sightline/contracts";

/** Head orientation relative to the camera, in degrees. Positive pitch = looking up. */
export type HeadAngles = { yaw: number; pitch: number };

/**
 * Yaw and pitch from MediaPipe's facial transformation matrix (column-major 4×4, canonical face → camera space).
 * The third column is the face's forward axis: (0, 0, 1) when the face points straight at the camera.
 */
export function headAngles(matrix: ArrayLike<number>): HeadAngles | null {
  if (matrix.length !== 16) return null;
  const [x, y, z] = [matrix[8], matrix[9], matrix[10]];
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-6) return null;
  const degrees = 180 / Math.PI;
  return {
    yaw: Math.atan2(x / length, z / length) * degrees,
    pitch: Math.atan2(y / length, Math.hypot(x, z) / length) * degrees,
  };
}

export const ATTENTION = {
  /** Faces seen in the first moments define "looking at the screen" (the camera rarely sits at eye level). */
  baselineMs: 1500,
  /** Head raised this far above the baseline: looking up at the board. */
  lookUpDeg: 12,
  /** Head lowered this far: looking down at a notebook or phone. */
  lookDownDeg: 20,
  /** Head turned this far to either side. */
  turnDeg: 28,
  /** No face for this long: away from the laptop. */
  noFaceMs: 800,
  /** A new zone has to hold this long, so a glance or a dropped frame doesn't flip it. */
  holdMs: 500,
};

/** Where the student is looking, judged against their own "looking at the screen" pose. */
export function classifyAttention(angles: HeadAngles | null, baseline: HeadAngles): GazeZone {
  if (!angles) return "AWAY";
  const pitch = angles.pitch - baseline.pitch;
  if (Math.abs(angles.yaw - baseline.yaw) > ATTENTION.turnDeg) return "AWAY";
  if (pitch > ATTENTION.lookUpDeg) return "BOARD";
  if (pitch < -ATTENTION.lookDownDeg) return "AWAY";
  return "SCREEN";
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Turns per-frame head angles (null = no face) into steady zone changes. Learns the screen pose from the first
 * `baselineMs` of faces (call `recenter` to learn it again), and commits a new zone only once it has held.
 */
export class AttentionTracker {
  private baseline: HeadAngles | null = null;
  private samples: HeadAngles[] = [];
  private learningSince: number | null = null;
  private lastFaceAt: number | null = null;
  private candidate: { zone: GazeZone; since: number } | null = null;
  zone: GazeZone = "SCREEN";

  get calibrated() {
    return this.baseline !== null;
  }

  recenter() {
    this.baseline = null;
    this.samples = [];
    this.learningSince = null;
    this.candidate = null;
    this.zone = "SCREEN";
  }

  /** Feed one frame. Returns the new zone when it changed, otherwise null. */
  update(angles: HeadAngles | null, now: number): GazeZone | null {
    if (angles) this.lastFaceAt = now;
    if (!this.baseline) {
      if (!angles) return null;
      this.learningSince ??= now;
      this.samples.push(angles);
      if (now - this.learningSince < ATTENTION.baselineMs) return null;
      this.baseline = { yaw: median(this.samples.map((s) => s.yaw)), pitch: median(this.samples.map((s) => s.pitch)) };
      this.samples = [];
    }

    // A face missing for a frame or two is a detector hiccup, not the student leaving.
    const faceGone = !angles && (this.lastFaceAt === null || now - this.lastFaceAt >= ATTENTION.noFaceMs);
    if (!angles && !faceGone) return null;
    const seen = classifyAttention(angles, this.baseline);

    if (seen === this.zone) {
      this.candidate = null;
      return null;
    }
    if (this.candidate?.zone !== seen) this.candidate = { zone: seen, since: now };
    if (now - this.candidate.since < ATTENTION.holdMs) return null;
    this.zone = seen;
    this.candidate = null;
    return seen;
  }
}
