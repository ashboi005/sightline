import {
  cameraFrameGeometry,
  drawCameraFrame,
  normalizeCameraTransform,
  readCameraTransform,
  saveCameraTransform,
  type CameraTransform,
} from "../eye-tracking/camera-transform"
import { NetworkCamera } from "../eye-tracking/network-camera"
import { videoFrameTimestamp } from "../eye-tracking/video-frame-clock"
import {
  getCameraErrorMessage,
  waitForVideoDimensions,
} from "../eye-tracking/video-source"
import type { SceneCameraSnapshot, SceneSource } from "./scene-camera.types"
import type { SceneObservation } from "./scene.types"
export type { SceneCameraSnapshot, SceneSource } from "./scene-camera.types"
export class SceneCamera {
  constructor(private readonly role: "scene" | "esp" = "scene") {
    this.snapshot.transform = readCameraTransform(role)
  }
  readonly rawCanvas = document.createElement("canvas")
  latest: SceneObservation | null = null
  stream: MediaStream | null = null
  private snapshot: SceneCameraSnapshot = {
    source: null,
    busy: false,
    error: "",
    devices: [],
    frame: null,
    connection: "idle",
    retryAttempt: 0,
    transform: readCameraTransform("scene"),
  }
  private listeners = new Set<() => void>()
  private video: HTMLVideoElement | null = null
  private network: NetworkCamera | null = null
  private observationGeneration = 0
  private generation = 0
  private sequence = 0
  private raf = 0
  private videoFrameHandle = 0
  private usesFrameCallbacks = false
  private videoFrameReady = false
  private videoFrameTimestamp = 0
  private videoFrameArrival = 0
  private lastPresentedFrames = -1
  private lastArrival = 0
  private disposed = false
  private refreshDevices = async () => {
    try {
      const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? []
      if (!this.disposed) {
        this.update({ devices: devices.filter((d) => d.kind === "videoinput") })
      }
    } catch {
      /* Permission-sensitive enumeration can fail before startup. */
    }
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(next: Partial<SceneCameraSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next }
    this.listeners.forEach((listener) => listener())
  }
  private clearCurrentFrame(connection: SceneCameraSnapshot["connection"]) {
    this.latest = null
    this.observationGeneration++
    this.update({ frame: null, connection })
  }
  mount() {
    this.disposed = false
    void this.refreshDevices()
    navigator.mediaDevices?.addEventListener(
      "devicechange",
      this.refreshDevices
    )
  }
  stop(error = "") {
    this.generation++
    this.observationGeneration++
    this.network?.stop()
    this.network = null
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    if (this.video) {
      if (this.videoFrameHandle) {
        this.video.cancelVideoFrameCallback?.(this.videoFrameHandle)
      }
      this.video.pause()
      this.video.srcObject = null
      this.video.removeAttribute("src")
      this.video.load()
    }
    this.video = null
    this.latest = null
    this.videoFrameHandle = 0
    this.usesFrameCallbacks = false
    this.videoFrameReady = false
    this.lastPresentedFrames = -1
    this.update({
      source: null,
      busy: false,
      error,
      frame: null,
      connection: error ? "error" : "idle",
      retryAttempt: 0,
    })
  }
  dispose() {
    this.disposed = true
    this.stop()
    navigator.mediaDevices?.removeEventListener(
      "devicechange",
      this.refreshDevices
    )
  }
  async startCamera(deviceId: string, excludedDeviceId?: string) {
    this.stop()
    this.update({ busy: true })
    const epoch = this.generation
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera access needs localhost or HTTPS in a supported browser."
        )
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      if (epoch !== this.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      this.stream = stream
      const track = stream.getVideoTracks()[0]
      const actualId = track?.getSettings().deviceId
      if (excludedDeviceId && actualId === excludedDeviceId) {
        throw new Error(
          "Choose a different USB device for the scene camera and the eye camera."
        )
      }
      const video = document.createElement("video")
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      this.video = video
      await video.play()
      await waitForVideoDimensions(video)
      if (epoch !== this.generation) {
        return
      }
      this.activate(
        {
          kind: "camera",
          name: track?.label || "Scene camera",
          key: `usb:${actualId || deviceId}:${epoch}`,
          deviceId: actualId || deviceId,
        },
        epoch
      )
      track?.addEventListener(
        "ended",
        () => {
          if (this.stream === stream) {
            this.stop("Scene camera disconnected. Reconnect it and try again.")
          }
        },
        { once: true }
      )
      void this.refreshDevices()
    } catch (error) {
      if (epoch === this.generation) {
        this.stop(getCameraErrorMessage(error))
      }
    }
  }
  setTransform = (value: CameraTransform) => {
    const transform = normalizeCameraTransform(value)
    if (JSON.stringify(transform) === JSON.stringify(this.snapshot.transform)) {
      return
    }
    saveCameraTransform(this.role, transform)
    this.observationGeneration++
    this.latest = null
    this.update({ transform, frame: null })
  }
  async startNetworkStream(input: string) {
    this.stop()
    const epoch = this.generation
    const url = input.trim()
    const source: SceneSource = {
      kind: "network",
      name: url,
      url,
      key: "network:" + url + ":" + epoch,
    }
    const network = new NetworkCamera({
      onStatus: (connection, retryAttempt, detail) => {
        if (epoch === this.generation) {
          this.update({
            connection,
            retryAttempt,
            ...(detail
              ? { error: detail }
              : connection === "live"
                ? { error: "" }
                : {}),
            busy: connection === "connecting" || connection === "reconnecting",
          })
        }
      },
      onError: (error) => {
        if (epoch === this.generation) {
          this.update({ error, busy: false })
        }
      },
      onFrame: (frame) => {
        if (epoch !== this.generation) {
          return
        }
        if (!frame) {
          this.clearCurrentFrame(this.snapshot.connection)
          return
        }
        this.draw(frame.image, frame.width, frame.height, frame.timestamp)
        if (epoch !== this.generation || !this.latest) {
          return
        }
        if (!this.snapshot.source) {
          this.update({ source, error: "", busy: false })
        }
      },
    })
    this.network = network
    await network.start(url)
  }
  private draw(
    image: HTMLVideoElement | ImageBitmap,
    inputWidth: number,
    inputHeight: number,
    timestamp: number
  ) {
    if (!inputWidth || !inputHeight) {
      return
    }
    const { width, height } = cameraFrameGeometry(
      inputWidth,
      inputHeight,
      this.snapshot.transform
    )
    if (this.rawCanvas.width !== width) {
      this.rawCanvas.width = width
    }
    if (this.rawCanvas.height !== height) {
      this.rawCanvas.height = height
    }
    const ctx = this.rawCanvas.getContext("2d")
    if (!ctx) {
      this.stop("Unable to create a scene preview in this browser.")
      return
    }
    try {
      drawCameraFrame(
        ctx,
        image,
        inputWidth,
        inputHeight,
        this.snapshot.transform,
        { width, height }
      )
    } catch {
      this.latest = null
      return
    }
    this.latest = {
      id: ++this.sequence,
      timestamp,
      width,
      height,
      inputWidth,
      inputHeight,
      generation: this.observationGeneration,
    }
    this.update({ frame: this.latest, connection: "live" })
  }
  private activate(source: SceneSource, epoch: number) {
    this.lastArrival = performance.now()
    this.update({ source, busy: false, error: "", connection: "live" })
    const video = this.video
    this.usesFrameCallbacks = !!video?.requestVideoFrameCallback
    if (video && this.usesFrameCallbacks) {
      const presented: VideoFrameRequestCallback = (now, metadata) => {
        if (epoch !== this.generation || this.disposed) {
          return
        }
        if (metadata.presentedFrames !== this.lastPresentedFrames) {
          this.lastPresentedFrames = metadata.presentedFrames
          this.videoFrameReady = true
          this.videoFrameArrival = now
          this.videoFrameTimestamp =
            source.kind === "camera"
              ? (videoFrameTimestamp(metadata, now) ?? now)
              : now
        }
        this.videoFrameHandle = video.requestVideoFrameCallback(presented)
      }
      this.videoFrameHandle = video.requestVideoFrameCallback(presented)
    } else if (video && typeof video.getVideoPlaybackQuality !== "function") {
      this.stop(
        "Scene video needs video-frame callbacks or playback frame counters. Use a current browser."
      )
      return
    }
    const loop = (time: number) => {
      if (epoch !== this.generation || this.disposed) {
        return
      }
      const image = this.video
      const quality = !this.usesFrameCallbacks
        ? this.video?.getVideoPlaybackQuality?.()
        : null
      const presentedFrames = quality
        ? quality.totalVideoFrames - quality.droppedVideoFrames
        : -1
      const fresh =
        !!image &&
        this.video!.readyState >= 2 &&
        (this.usesFrameCallbacks
          ? this.videoFrameReady
          : presentedFrames > 0 && presentedFrames !== this.lastPresentedFrames)
      if (fresh && image) {
        const width = this.video!.videoWidth
        const height = this.video!.videoHeight
        if (width && height) {
          this.videoFrameReady = false
          if (!this.usesFrameCallbacks) {
            this.lastPresentedFrames = presentedFrames
          }
          this.lastArrival = time
          if (this.usesFrameCallbacks) {
            this.lastArrival = this.videoFrameArrival
          }
          this.draw(
            image,
            width,
            height,
            this.usesFrameCallbacks ? this.videoFrameTimestamp : time
          )
        }
      }
      if (
        time - this.lastArrival > 2000 &&
        this.snapshot.connection !== "waiting"
      ) {
        this.clearCurrentFrame("waiting")
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }
}
