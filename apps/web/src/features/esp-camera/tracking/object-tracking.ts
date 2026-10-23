import { hasFreshFrame } from "./selection"
import type { ViewerCamera } from "./viewer-camera.types"
import type { SceneCameraSnapshot } from "../../scene-tracking/features/scene-eye-tracking/scene-camera.types"
import type {
  FrameContext,
  ObjectBox,
  ObjectChoice,
  ObjectMatch,
  ObjectReference,
  ObjectTrackingSnapshot,
  TrackingDependencies,
  VisionRecord,
  VisionRequest,
  VisionTransport,
} from "./object-tracking.types"

const empty = (): ObjectTrackingSnapshot => ({
  status: "idle",
  reference: null,
  match: null,
  scene: null,
  error: "",
})
export function validObjectBox(value: unknown): value is ObjectBox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1
    ) &&
    value[0] < value[2] &&
    value[1] < value[3]
  )
}
export function transformKey(state: SceneCameraSnapshot) {
  const { rotation, mirrorX, mirrorY } = state.transform
  return `${rotation}:${mirrorX}:${mirrorY}`
}
function sameCamera(context: FrameContext, state: SceneCameraSnapshot) {
  // Source keys include the connection epoch. Observation generations also
  // advance on network silence, which must invalidate frames, not identity.
  return (
    state.source?.key === context.sourceKey &&
    transformKey(state) === context.transformKey
  )
}
export function sameSource(context: FrameContext, state: SceneCameraSnapshot) {
  return (
    sameCamera(context, state) &&
    (!state.frame || state.frame.generation === context.generation)
  )
}
function context(state: SceneCameraSnapshot): FrameContext {
  return {
    sourceKey: state.source!.key,
    transformKey: transformKey(state),
    generation: state.frame!.generation,
    timestamp: state.frame!.timestamp,
  }
}
function frameKey(state: SceneCameraSnapshot) {
  return `${state.source!.key}:${transformKey(state)}:${state.frame!.generation}:${state.frame!.id}`
}
function encodeFrame(camera: ViewerCamera) {
  const source = camera.rawCanvas
  const canvas = document.createElement("canvas")
  const scale = Math.min(1, 960 / Math.max(source.width, source.height))
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error(
      "Camera pixels are unavailable. Retry after connecting the camera."
    )
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const data = canvas.toDataURL("image/jpeg", 0.85)
  if (!data.startsWith("data:image/jpeg;base64,")) {
    throw new Error("Camera frame could not be read.")
  }
  return data.slice("data:image/jpeg;base64,".length)
}
export const requestVision: VisionTransport = async (request, signal) => {
  let response: Response
  try {
    response = await fetch("/api/viewer-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(22000)]),
    })
  } catch {
    throw new Error(
      "Tracking connection unavailable. Restart the Sightline server and retry."
    )
  }
  const body: unknown = await response.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Vision returned an invalid result. Retry Select.")
  }
  const result = body as VisionRecord
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Tracking unavailable. Retry Select."
    )
  }
  return result
}

export class ObjectTracking {
  private state = empty()
  private listeners = new Set<() => void>()
  private revision = 0
  private pending: Promise<void> | null = null
  private abort = new AbortController()
  private lastFrame = ""
  private lastSceneFrame = ""
  private targetContext: FrameContext | null = null
  private targetStream = 0
  private readonly request: VisionTransport
  private readonly encode: (camera: ViewerCamera) => string
  private readonly now: () => number
  constructor(dependencies: TrackingDependencies = {}) {
    this.request = dependencies.request ?? requestVision
    this.encode = dependencies.encode ?? encodeFrame
    this.now = dependencies.now ?? (() => performance.now())
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(state: ObjectTrackingSnapshot) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
  private enqueue(work: () => Promise<void>) {
    const previous = this.pending
    const task = (async () => {
      if (previous) {
        await previous.catch(() => {})
      }
      await work()
    })()
    this.pending = task
    void task
      .finally(() => {
        if (this.pending === task) {
          this.pending = null
        }
      })
      .catch(() => {})
    return task
  }
  private cleanup(token: string) {
    return this.request({ action: "clear", token }, this.abort.signal)
      .then(() => {})
      .catch(() => {})
  }
  clear() {
    const token = this.state.reference?.token
    this.revision++
    this.lastFrame = ""
    this.lastSceneFrame = ""
    this.targetContext = null
    this.publish(empty())
    if (token) {
      void this.enqueue(() => this.cleanup(token))
    }
  }
  async select(camera: ViewerCamera, choice: ObjectChoice) {
    const source = camera.getSnapshot()
    if (this.state.reference && !sameCamera(this.state.reference, source))
      this.clear()
    const previous = this.state
    const oldToken = previous.reference?.token
    // Replacement is transactional: an empty click must not erase a good lock.
    const revision = ++this.revision
    if (!hasFreshFrame(source, this.now())) {
      this.fail(
        new Error("Wait for a fresh Scene frame before selecting."),
        true
      )
      return
    }
    let image: string
    try {
      image = this.encode(camera)
    } catch (failure) {
      this.fail(
        failure instanceof DOMException && failure.name === "SecurityError"
          ? new Error(
              "This network stream blocks image analysis. Enable camera CORS or use USB."
            )
          : failure,
        true
      )
      return
    }
    const stamp = context(source)
    this.lastSceneFrame = frameKey(source)
    this.publish({
      ...previous,
      status: "selecting",
      match: null,
      error: "",
      selectionError: "",
    })
    await this.enqueue(async () => {
      if (revision !== this.revision) {
        return
      }
      try {
        const result = await this.request(
          { action: "select", image, ...choice },
          this.abort.signal
        )
        const token = result.token
        if (
          typeof token !== "string" ||
          !token ||
          token.length > 64 ||
          !validObjectBox(result.box) ||
          typeof result.label !== "string"
        ) {
          throw new Error("Vision returned an invalid selection. Retry Select.")
        }
        if (
          revision !== this.revision ||
          !sameSource(stamp, camera.getSnapshot())
        ) {
          await this.cleanup(token)
          if (revision === this.revision) {
            if (!sameCamera(stamp, camera.getSnapshot())) this.clear()
            else
              this.fail(
                new Error(
                  "The stream paused during selection. Select again on a fresh frame."
                ),
                true
              )
          }
          return
        }
        const initialScene: ObjectMatch = {
          ...stamp,
          box: result.box,
          score: 1,
          method: "temporal",
        }
        this.lastFrame = ""
        this.targetContext = null
        this.publish({
          ...empty(),
          status: "searching",
          scene: initialScene,
          lastScene: initialScene,
          sceneStatus: "matched",
          targetStatus: "searching",
          reference: {
            ...stamp,
            token,
            box: result.box,
            label: result.label.slice(0, 80),
            ...(typeof result.preview === "string" &&
            result.preview.length < 180000 &&
            /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result.preview)
              ? { preview: result.preview }
              : {}),
          },
        })
        if (oldToken && oldToken !== token) await this.cleanup(oldToken)
      } catch (failure) {
        if (revision === this.revision) {
          this.fail(failure, true)
        }
      }
    })
  }
  async tick(scene: ViewerCamera, auxiliary: ViewerCamera) {
    const selected = this.state.reference
    if (!selected) {
      return
    }
    const sceneState = scene.getSnapshot()
    if (!sameCamera(selected, sceneState)) {
      this.clear()
      return
    }
    if (this.state.requiresReselect) return
    const targetState = auxiliary.getSnapshot()
    if (this.state.lastMatch && !sameSource(this.state.lastMatch, targetState))
      this.publish({ ...this.state, lastMatch: null })
    const now = this.now()
    const expired = (match: ObjectMatch | null | undefined) =>
      !!match && (now < match.timestamp || now - match.timestamp > 500)
    if (
      this.state.scene &&
      (!hasFreshFrame(sceneState, now) || expired(this.state.scene))
    ) {
      this.publish({ ...this.state, scene: null })
    }
    if (
      !hasFreshFrame(targetState, now) ||
      expired(this.state.match) ||
      (this.state.match && !sameSource(this.state.match, targetState))
    ) {
      if (this.state.match) {
        this.publish({ ...this.state, status: "searching", match: null })
      }
    }
    if (this.pending) {
      return
    }
    const sceneFrame = hasFreshFrame(sceneState, this.now())
      ? frameKey(sceneState)
      : ""
    const targetFrame = hasFreshFrame(targetState, this.now())
      ? frameKey(targetState)
      : ""
    const updateScene =
      this.state.sceneStatus !== "lost" &&
      !!sceneFrame &&
      sceneFrame !== this.lastSceneFrame
    const updateTarget = !!targetFrame && targetFrame !== this.lastFrame
    if (!updateScene && !updateTarget) {
      return
    }
    const revision = this.revision
    await this.enqueue(async () => {
      if (revision !== this.revision) {
        return
      }
      if (updateScene) {
        await this.analyze(scene, scene, selected, revision, "scene")
      }
      if (revision === this.revision && !this.state.requiresReselect) {
        await this.analyze(auxiliary, scene, selected, revision, "target")
      }
    })
  }
  private async analyze(
    camera: ViewerCamera,
    scene: ViewerCamera,
    selected: ObjectReference,
    revision: number,
    role: "scene" | "target"
  ) {
    // Snapshot the same frame whose pixels are about to be encoded. A previous
    // camera snapshot can be stale after waiting for the other view's inference.
    const source = camera.getSnapshot()
    if (
      !hasFreshFrame(source, this.now()) ||
      !sameCamera(selected, scene.getSnapshot())
    ) {
      return
    }
    const key = frameKey(source)
    if (key === (role === "scene" ? this.lastSceneFrame : this.lastFrame)) {
      return
    }
    const stamp = context(source)
    if (role === "scene") {
      this.lastSceneFrame = key
    } else {
      this.lastFrame = key
      if (!this.targetContext || !sameCamera(this.targetContext, source)) {
        this.targetStream++
        this.targetContext = stamp
      }
    }
    try {
      const image = this.encode(camera)
      const request: VisionRequest =
        role === "scene"
          ? { action: "track", token: selected.token, image }
          : {
              action: "match",
              token: selected.token,
              image,
              stream: this.targetStream,
            }
      const result = await this.request(request, this.abort.signal)
      if (
        revision !== this.revision ||
        !sameSource(stamp, camera.getSnapshot()) ||
        !sameCamera(selected, scene.getSnapshot())
      ) {
        return
      }
      const fresh =
        hasFreshFrame(camera.getSnapshot(), this.now()) &&
        this.now() >= stamp.timestamp &&
        this.now() - stamp.timestamp <= 500
      if (result.status === "lost" && result.requiresReselect === true) {
        if (role === "scene") {
          // Scene supplies the reference. Its person leaving must not discard an
          // independently verified lock that the moving ESP-CAM still sees.
          this.publish({
            ...this.state,
            sceneStatus: "lost",
            scene: null,
            lastScene: null,
          })
          return
        }
        this.publish({
          ...this.state,
          status: "lost",
          requiresReselect: true,
          targetStatus: "lost",
          scene: null,
          match: null,
          lastScene: null,
          lastMatch: null,
          error:
            "Person lock lost. Select the person again; movement has stopped.",
        })
        return
      }
      let match: ObjectMatch | null = null
      if (result.status === "matched" && fresh) {
        const temporal = result.method === "temporal"
        const appearance = result.method === "appearance"
        const flow = result.method === "flow"
        const person = result.method === "person"
        if (
          !validObjectBox(result.box) ||
          typeof result.score !== "number" ||
          !Number.isFinite(result.score) ||
          (person ? result.score < 0.65 : result.score <= 0.8) ||
          result.score > 1 ||
          (person &&
            (typeof result.identityMargin !== "number" ||
              !Number.isFinite(result.identityMargin) ||
              result.identityMargin < 0.08 ||
              result.identityMargin > 1 ||
              typeof result.detectionConfidence !== "number" ||
              !Number.isFinite(result.detectionConfidence) ||
              result.detectionConfidence < 0.3 ||
              result.detectionConfidence > 1)) ||
          (appearance && result.score <= 0.92) ||
          (!temporal &&
            !appearance &&
            !person &&
            (typeof result.inliers !== "number" ||
              !Number.isInteger(result.inliers) ||
              result.inliers < 8))
        ) {
          throw new Error("Vision could not verify this match. Retry Select.")
        }
        let method: ObjectMatch["method"]
        if (temporal) {
          method = "temporal"
        }
        if (appearance) {
          method = "appearance"
        }
        if (flow) {
          method = "flow"
        }
        if (person) method = "person"
        match = {
          ...stamp,
          box: result.box,
          score: result.score,
          method,
          ...(person
            ? {
                identityMargin: result.identityMargin as number,
                detectionConfidence: result.detectionConfidence as number,
              }
            : {}),
        }
      } else if (
        !["matched", "searching", "ambiguous"].includes(String(result.status))
      ) {
        throw new Error("Vision returned an invalid match. Retry Select.")
      }
      if (role === "scene") {
        this.publish({
          ...this.state,
          error: "",
          status:
            this.state.status === "error" ? "searching" : this.state.status,
          scene: match,
          sceneStatus: match
            ? "matched"
            : result.status === "ambiguous"
              ? "ambiguous"
              : "searching",
          lastScene: match ?? this.state.lastScene,
        })
      } else {
        let status: ObjectTrackingSnapshot["status"] = "searching"
        if (match) {
          status = "matched"
        } else if (result.status === "ambiguous" && fresh) {
          status = "ambiguous"
        }
        this.publish({
          ...this.state,
          status,
          error: "",
          match,
          targetStatus: match
            ? "matched"
            : result.status === "ambiguous"
              ? "ambiguous"
              : "searching",
          lastMatch: match ?? this.state.lastMatch,
        })
      }
    } catch (failure) {
      if (
        revision === this.revision &&
        sameSource(stamp, camera.getSnapshot()) &&
        sameCamera(selected, scene.getSnapshot())
      ) {
        if (role === "scene") {
          this.publish({ ...this.state, scene: null })
        }
        this.fail(failure)
      }
    }
  }
  private fail(failure: unknown, selection = false) {
    const error =
      failure instanceof Error
        ? failure.message
        : "Tracking unavailable. Retry Select."
    this.publish({
      ...this.state,
      status: "error",
      match: null,
      lastMatch: null,
      error,
      ...(selection ? { selectionError: error } : {}),
    })
  }
}
