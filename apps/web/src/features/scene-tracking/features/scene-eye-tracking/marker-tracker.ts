import type {
  MarkerTrackerSnapshot,
  MarkerWorkerReply,
  MarkerWorkerRequest,
} from "./marker-tracker.types"
import type { SceneCamera } from "./scene-camera"
import type { SceneObservation } from "./scene.types"
export type {
  MarkerTrackerSnapshot,
  MarkerWorkerReply,
  MarkerWorkerRequest,
} from "./marker-tracker.types"
const maxAgeMs = 250
export class MarkerTracker {
  private snapshot: MarkerTrackerSnapshot = {
    status: "idle",
    error: "",
    marker: null,
  }
  private listeners = new Set<() => void>()
  private worker: Worker | null = null
  private unsubscribe: (() => void) | null = null
  private generation = 0
  private pending: SceneObservation | null = null
  private lastId = -1
  private sourceGeneration = -1
  private camera: SceneCamera
  private factory: () => Worker
  private makeBitmap: (image: HTMLCanvasElement) => Promise<ImageBitmap>
  constructor(
    camera: SceneCamera,
    factory = () =>
      new Worker(new URL("./marker.worker.ts", import.meta.url), {
        type: "module",
      }),
    makeBitmap: (image: HTMLCanvasElement) => Promise<ImageBitmap> = (
      image
    ) => {
      const scale = Math.min(1, 960 / Math.max(image.width, image.height))
      return createImageBitmap(image, {
        resizeWidth: Math.max(1, Math.round(image.width * scale)),
        resizeHeight: Math.max(1, Math.round(image.height * scale)),
        resizeQuality: "high",
      })
    }
  ) {
    this.camera = camera
    this.factory = factory
    this.makeBitmap = makeBitmap
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(next: Partial<MarkerTrackerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next }
    this.listeners.forEach((listener) => listener())
  }
  private fail(error: string) {
    this.dispose()
    this.update({ status: "error", error })
  }
  start() {
    this.dispose()
    this.update({ status: "loading", error: "", marker: null })
    const epoch = this.generation
    try {
      const worker = this.factory()
      this.worker = worker
      worker.onmessage = (event: MessageEvent<MarkerWorkerReply>) => {
        const message = event.data
        if (epoch !== this.generation || message.generation !== epoch) {
          return
        }
        if (message.type === "ready") {
          this.update({ status: "ready" })
          this.pump()
        } else if (message.type === "error") {
          this.fail(message.error)
        } else if (message.type === "result") {
          const scene = message.marker.scene
          if (
            !this.pending ||
            scene.id !== this.pending.id ||
            scene.generation !== this.pending.generation ||
            scene.timestamp !== this.pending.timestamp
          ) {
            return
          }
          this.pending = null
          this.update({ marker: this.fresh(scene) ? message.marker : null })
          this.pump()
        }
      }
      worker.onerror = () => {
        if (epoch === this.generation) {
          this.fail(
            "Marker tracking could not start. Retry in a browser with worker and OffscreenCanvas support."
          )
        }
      }
      worker.onmessageerror = () => {
        if (epoch === this.generation) {
          this.fail(
            "The marker worker returned unreadable data. Retry marker tracking."
          )
        }
      }
      this.unsubscribe = this.camera.subscribe(this.pump)
      worker.postMessage({
        type: "init",
        generation: epoch,
      } satisfies MarkerWorkerRequest)
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : "This browser cannot run the marker worker."
      )
    }
  }
  private fresh(scene: SceneObservation): boolean {
    const latest = this.camera.latest
    return (
      !!latest &&
      scene.generation === latest.generation &&
      latest.timestamp >= scene.timestamp &&
      latest.timestamp - scene.timestamp <= maxAgeMs &&
      performance.now() - scene.timestamp <= maxAgeMs
    )
  }
  private pump = () => {
    const scene = this.camera.latest
    if (this.snapshot.marker && !this.fresh(this.snapshot.marker.scene)) {
      this.update({ marker: null })
    }
    if (!scene) {
      return
    }
    if (scene.generation !== this.sourceGeneration) {
      this.sourceGeneration = scene.generation
      this.lastId = -1
      if (this.snapshot.marker) {
        this.update({ marker: null })
      }
    }
    if (
      this.snapshot.status !== "ready" ||
      !this.worker ||
      this.pending ||
      scene.id === this.lastId
    ) {
      return
    }
    const captured = { ...scene }
    const epoch = this.generation
    this.pending = captured
    this.lastId = scene.id
    void this.makeBitmap(this.camera.rawCanvas)
      .then((bitmap) => {
        if (epoch !== this.generation || !this.worker) {
          bitmap.close()
          return
        }
        if (!this.fresh(captured)) {
          bitmap.close()
          this.pending = null
          this.pump()
          return
        }
        try {
          this.worker.postMessage(
            {
              type: "frame",
              generation: epoch,
              scene: captured,
              bitmap,
            } satisfies MarkerWorkerRequest,
            [bitmap]
          )
        } catch (error) {
          bitmap.close()
          throw error
        }
      })
      .catch((error) => {
        if (epoch === this.generation) {
          this.fail(
            error instanceof Error
              ? error.message
              : "Unable to read the scene camera for marker tracking."
          )
        }
      })
  }
  dispose() {
    this.generation++
    this.unsubscribe?.()
    this.unsubscribe = null
    this.worker?.terminate()
    this.worker = null
    this.pending = null
    this.lastId = -1
    this.sourceGeneration = -1
    this.update({ status: "idle", error: "", marker: null })
  }
}
