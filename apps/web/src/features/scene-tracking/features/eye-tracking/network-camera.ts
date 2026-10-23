import type {
  Callbacks,
  NetworkCameraBytes,
  NetworkConnectionState,
} from "./network-camera.types"
import { CameraAccessError, openNetworkSource } from "./network-source"
import type { NetworkSource } from "./network-source.types"
export type {
  NetworkCameraFrame,
  NetworkConnectionState,
} from "./network-camera.types"
export const NETWORK_CONNECTION_LABELS: Record<NetworkConnectionState, string> =
  {
    idle: "Not connected",
    connecting: "Connecting camera…",
    live: "Live",
    waiting: "Waiting for camera frames…",
    reconnecting: "Reconnecting automatically…",
    error: "Connection unavailable",
  }
const MAX_RECONNECT_ATTEMPTS = 4
const CONNECTION_TIMEOUT_MS = 15000
// Owns the network media and retries. Consumers only borrow its latest image.
export class NetworkCamera {
  private active = false
  private token = 0
  private input = ""
  private connectionUrl = ""
  private localRelay = false
  private retries = 0
  private sequence = 0
  private state: NetworkConnectionState = "idle"
  private abort: AbortController | null = null
  private video: HTMLVideoElement | null = null
  private bitmap: ImageBitmap | null = null
  private frames: AsyncGenerator<Uint8Array, void, unknown> | null = null
  private pending: NetworkCameraBytes | null = null
  private lastArrival = 0
  private healthySince = 0
  private hasFrame = false
  private hasConnected = false
  private raf = 0
  private videoCallback = 0
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private readonly callbacks: Callbacks
  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks
  }
  async start(input: string): Promise<void> {
    this.stop()
    this.input = input.trim()
    this.connectionUrl = this.input
    try {
      const url = new URL(this.input)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error()
      }
    } catch {
      this.status("error")
      this.callbacks.onError(
        "Enter a complete HTTP or HTTPS camera stream URL."
      )
      return
    }
    this.active = true
    this.retries = 0
    this.status("connecting")
    this.heartbeat = setInterval(() => this.checkHealth(performance.now()), 500)
    await this.connect()
  }
  stop(): void {
    this.active = false
    this.hasConnected = false
    this.connectionUrl = ""
    this.localRelay = false
    this.token++
    clearInterval(this.heartbeat)
    clearTimeout(this.retry)
    this.heartbeat = undefined
    this.retry = undefined
    this.callbacks.onFrame(null)
    this.releaseMedia()
    this.status("idle")
  }
  private status(state: NetworkConnectionState, detail?: string) {
    if (this.state === state && state !== "reconnecting") {
      return
    }
    this.state = state
    this.callbacks.onStatus(state, this.retries, detail)
  }
  private async connect(): Promise<void> {
    if (!this.active) {
      return
    }
    const token = ++this.token
    const abort = new AbortController()
    this.abort = abort
    this.hasFrame = false
    this.deadline = setTimeout(() => {
      this.reconnect(
        token,
        "The camera did not send a readable frame within 15 seconds. Check that its stream is available."
      )
    }, CONNECTION_TIMEOUT_MS)
    try {
      const source = await openNetworkSource(
        this.connectionUrl,
        abort.signal,
        !this.hasConnected,
        this.localRelay
      )
      if (!this.current(token)) {
        this.disposeSource(source)
        return
      }
      this.connectionUrl = source.streamUrl
      this.localRelay = !!source.localRelay
      this.healthySince = performance.now()
      if (source.kind === "video") {
        this.video = source.video
        this.publish(source.video, performance.now(), token)
        this.watchVideo(source.video, token)
      } else {
        this.frames = source.frames
        let bytes = source.firstFrame
        let bitmap: ImageBitmap | null = null
        while (this.current(token) && !bitmap) {
          try {
            bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: "image/jpeg" })
            )
          } catch {
            // Some cameras send a partial JPEG when a subscriber joins.
            const next = await source.frames.next()
            if (next.done) {
              throw new Error("Camera stream ended before a readable frame.")
            }
            bytes = next.value
          }
        }
        if (!this.current(token)) {
          bitmap?.close()
          return
        }
        if (!bitmap) {
          return
        }
        this.bitmap = bitmap
        this.publish(this.bitmap, performance.now(), token)
        void this.readFrames(source.frames, token)
      }
    } catch (error) {
      if (!this.current(token)) {
        return
      }
      // Fetch cannot distinguish CORS rejection from a temporary network failure.
      if (error instanceof CameraAccessError && !this.hasConnected) {
        this.fail(error.message)
        return
      }
      const message =
        error instanceof Error ? error.message : "Camera connection failed."
      this.reconnect(token, message)
    }
  }
  private current(token: number) {
    return this.active && token === this.token
  }
  private publish(
    image: HTMLVideoElement | ImageBitmap,
    timestamp: number,
    token: number
  ) {
    if (!this.current(token)) {
      return
    }
    clearTimeout(this.deadline)
    this.deadline = undefined
    this.hasFrame = true
    this.hasConnected = true
    this.lastArrival = timestamp
    if (timestamp - this.healthySince >= 10000) {
      this.retries = 0
    }
    this.status("live")
    this.callbacks.onFrame({
      image,
      width: image instanceof HTMLVideoElement ? image.videoWidth : image.width,
      height:
        image instanceof HTMLVideoElement ? image.videoHeight : image.height,
      timestamp,
      sequence: ++this.sequence,
    })
  }
  private async readFrames(
    frames: AsyncGenerator<Uint8Array, void, unknown>,
    token: number
  ) {
    let decoding = false
    const decode = async () => {
      decoding = true
      try {
        while (this.pending && this.current(token)) {
          const pending = this.pending
          this.pending = null
          let bitmap: ImageBitmap
          try {
            bitmap = await createImageBitmap(
              new Blob([new Uint8Array(pending.bytes)], { type: "image/jpeg" })
            )
          } catch {
            // A damaged JPEG is a dropped frame, not a disconnected camera.
            continue
          }
          if (!this.current(token)) {
            bitmap.close()
            return
          }
          const previous = this.bitmap
          this.bitmap = bitmap
          this.publish(bitmap, pending.timestamp, token)
          previous?.close()
        }
      } finally {
        decoding = false
      }
    }
    try {
      for await (const bytes of frames) {
        if (!this.current(token)) {
          return
        }
        // Keep only the newest waiting JPEG while a decode is in flight.
        this.pending = { bytes, timestamp: performance.now() }
        if (!decoding) {
          void decode()
        }
      }
      if (this.current(token)) {
        this.reconnect(token)
      }
    } catch (error) {
      if (this.current(token)) {
        this.reconnect(
          token,
          error instanceof Error ? error.message : undefined
        )
      }
    }
  }
  private watchVideo(video: HTMLVideoElement, token: number) {
    const interrupted = () => this.reconnect(token)
    video.addEventListener("error", interrupted, { once: true })
    video.addEventListener("ended", interrupted, { once: true })
    const quality = video.getVideoPlaybackQuality?.()
    let presented = quality
      ? quality.totalVideoFrames - quality.droppedVideoFrames
      : video.currentTime
    if (typeof video.requestVideoFrameCallback === "function") {
      const frame: VideoFrameRequestCallback = (time, metadata) => {
        if (!this.current(token)) {
          return
        }
        if (metadata.presentedFrames !== presented) {
          presented = metadata.presentedFrames
          this.publish(video, time, token)
        }
        this.videoCallback = video.requestVideoFrameCallback(frame)
      }
      this.videoCallback = video.requestVideoFrameCallback(frame)
    } else {
      const loop = (time: number) => {
        if (!this.current(token)) {
          return
        }
        const quality = video.getVideoPlaybackQuality?.()
        const count = quality
          ? quality.totalVideoFrames - quality.droppedVideoFrames
          : video.currentTime
        if (video.readyState >= 2 && count !== presented) {
          presented = count
          this.publish(video, time, token)
        }
        this.checkHealth(time)
        if (this.current(token)) {
          this.raf = requestAnimationFrame(loop)
        }
      }
      this.raf = requestAnimationFrame(loop)
    }
  }
  private checkHealth(time: number) {
    if (!this.active || !this.hasFrame) {
      return
    }
    if (this.video && document.visibilityState === "hidden") {
      this.lastArrival = time
      return
    }
    const age = time - this.lastArrival
    if (age >= 8000) {
      this.reconnect(this.token)
    } else if (age >= 1500 && this.state === "live") {
      this.status("waiting")
      this.callbacks.onFrame(null)
    }
  }
  private fail(message: string) {
    this.stop()
    this.status("error")
    this.callbacks.onError(message)
  }
  private reconnect(
    token: number,
    message = "The camera stream keeps disconnecting. Check its connection and try again."
  ) {
    if (!this.current(token)) {
      return
    }
    if (this.retries >= MAX_RECONNECT_ATTEMPTS) {
      this.fail(message)
      return
    }
    this.token++
    this.callbacks.onFrame(null)
    this.releaseMedia()
    const delay = Math.min(1000 * 2 ** Math.min(this.retries, 4), 15000)
    this.retries++
    this.status("reconnecting", message)
    this.retry = setTimeout(() => {
      this.retry = undefined
      void this.connect()
    }, delay)
  }
  private disposeSource(source: NetworkSource) {
    if (source.kind === "mjpeg") {
      void source.frames.return(undefined).catch(() => {})
    } else {
      source.video.pause()
      source.video.removeAttribute("src")
      source.video.load()
    }
  }
  private releaseMedia() {
    clearTimeout(this.deadline)
    this.deadline = undefined
    this.hasFrame = false
    this.abort?.abort()
    this.abort = null
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.video) {
      if (this.videoCallback) {
        this.video.cancelVideoFrameCallback?.(this.videoCallback)
      }
      this.video.pause()
      this.video.removeAttribute("src")
      this.video.load()
    }
    this.video = null
    this.videoCallback = 0
    this.bitmap?.close()
    this.bitmap = null
    this.pending = null
    if (this.frames) {
      void this.frames.return(undefined).catch(() => {})
    }
    this.frames = null
  }
}
