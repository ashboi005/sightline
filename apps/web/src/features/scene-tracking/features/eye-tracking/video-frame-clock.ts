import type { VideoFrameTiming } from "./video-frame-clock.types"
export function videoFrameTimestamp(
  metadata: VideoFrameCallbackMetadata,
  now: number
): number | null {
  const timestamp = Number.isFinite(metadata.captureTime)
    ? metadata.captureTime!
    : metadata.presentationTime
  return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= now
    ? timestamp
    : null
}
/** Use the camera's capture timestamp when the browser exposes it, otherwise presentation time.
 * MJPEG has no shared exposure clock; timestamp pairing alone cannot undo its network delay. */
export class VideoFrameClock {
  private video: HTMLVideoElement | null = null
  private handle: number | null = null
  private timing: VideoFrameTiming | null = null
  watch(video: HTMLVideoElement): void {
    if (this.video === video) {
      return
    }
    this.stop()
    this.video = video
    if (typeof video.requestVideoFrameCallback !== "function") {
      return
    }
    const update = (
      now: number,
      metadata: VideoFrameCallbackMetadata
    ): void => {
      if (this.video !== video) {
        return
      }
      const timestamp = videoFrameTimestamp(metadata, now)
      if (timestamp !== null) {
        this.timing = { timestamp, mediaTime: metadata.mediaTime }
      }
      this.handle = video.requestVideoFrameCallback(update)
    }
    this.handle = video.requestVideoFrameCallback(update)
  }
  read(now: number): number {
    if (!this.video || !this.timing) {
      return now
    }
    // A frame callback may be delayed or a source may seek. Do not assign its old time to a new image.
    if (Math.abs(this.video.currentTime - this.timing.mediaTime) > 0.08) {
      return now
    }
    return this.timing.timestamp
  }
  stop(): void {
    if (this.video && this.handle !== null) {
      this.video.cancelVideoFrameCallback(this.handle)
    }
    this.video = null
    this.handle = null
    this.timing = null
  }
}
