import { MAX_FRAME_AGE_MS } from "./calibration"
import type { StableHandResult } from "./hand-stability.types"
import type { HandObservation, Landmark } from "./scene.types"
const PALM = [0, 5, 9, 13, 17]
const distance = (a: Landmark, b: Landmark, hand: HandObservation) =>
  Math.hypot((a.x - b.x) * hand.scene.width, (a.y - b.y) * hand.scene.height) /
  Math.min(hand.scene.width, hand.scene.height)
const movement = (a: HandObservation, b: HandObservation) =>
  Math.max(...a.landmarks[0].map((p, i) => distance(p, b.landmarks[0][i], a)))
const rejected = (hand: HandObservation, reason: string) => ({
  ...hand,
  landmarks: [],
  worldLandmarks: [],
  handedness: [],
  reason,
})
/** Reject isolated jumps; smooth only the drawing, never the calibration data. */
export class HandStability {
  private previous: HandObservation | null = null
  private pending: HandObservation | null = null
  private preview: HandObservation | null = null
  reset() {
    this.previous = this.pending = this.preview = null
  }
  apply(hand: HandObservation): StableHandResult {
    if (hand.landmarks.length !== 1) {
      this.pending = null
      return { hand, preview: null }
    }
    const joints = hand.landmarks[0]
    const { scene } = hand
    if (
      joints.length !== 21 ||
      ![scene.timestamp, scene.width, scene.height].every(Number.isFinite) ||
      scene.width <= 0 ||
      scene.height <= 0 ||
      joints.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
    ) {
      return {
        hand: rejected(hand, "Hand landmarks unavailable."),
        preview: null,
      }
    }
    let previous = this.previous
    if (
      previous &&
      (previous.scene.generation !== scene.generation ||
        previous.scene.width !== scene.width ||
        previous.scene.height !== scene.height ||
        scene.timestamp - previous.scene.timestamp > MAX_FRAME_AGE_MS)
    ) {
      this.reset()
      previous = null
    }
    if (previous && scene.timestamp <= previous.scene.timestamp) {
      return {
        hand: rejected(hand, "Waiting for a fresh hand frame."),
        preview: null,
      }
    }
    let resetPreview = !previous
    if (previous) {
      const palm = previous.landmarks[0]
      const palmSize = Math.max(
        ...PALM.flatMap((a) =>
          PALM.map((b) => distance(palm[a], palm[b], hand))
        )
      )
      const limit = Math.max(0.06, palmSize * 0.75)
      if (movement(hand, previous) > limit) {
        // A real fast movement becomes evidence on a second matching frame.
        // A one-frame detector spike stays missing evidence and pauses capture.
        const confirmed =
          this.pending &&
          scene.timestamp > this.pending.scene.timestamp &&
          scene.timestamp - this.pending.scene.timestamp <= MAX_FRAME_AGE_MS &&
          movement(hand, this.pending) <= limit * 0.5
        if (!confirmed) {
          this.pending = hand
          return {
            hand: rejected(hand, "Hand jumped. Reacquiring fingertip…"),
            preview: null,
          }
        }
        resetPreview = true
      }
    }
    this.pending = null
    const oldPreview = this.preview
    let preview = hand
    if (!resetPreview && previous && oldPreview) {
      const elapsed = (scene.timestamp - previous.scene.timestamp) / 1000
      const speed = movement(hand, previous) / elapsed
      const tau = speed > 0.5 ? 0.008 : 0.04
      const alpha = 1 - Math.exp(-elapsed / tau)
      preview = {
        ...hand,
        landmarks: [
          joints.map((p, i) => {
            const old = oldPreview.landmarks[0][i]
            return {
              x: old.x + alpha * (p.x - old.x),
              y: old.y + alpha * (p.y - old.y),
              z: p.z,
            }
          }),
        ],
      }
    }
    this.previous = hand
    this.preview = preview
    return { hand, preview }
  }
}
