import { expect, test, spyOn } from "bun:test"
import { calibrate } from "@/features/scene-tracking/tests/fixtures"
import type { GazeMeasurement } from "@/features/scene-tracking/features/scene-eye-tracking/scene.types"
import { SceneGazeCursor, sceneGazeCursor } from "../selection"
import { ObjectTracking, requestVision } from "../object-tracking"
import type { ViewerCamera } from "../viewer-camera.types"
import { liveSnapshot } from "./fixtures"
import type { VisionRecord, VisionRequest } from "../object-tracking.types"

function camera() {
  const camera: ViewerCamera = {
    rawCanvas: {} as HTMLCanvasElement,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  }
  const snapshot = liveSnapshot()
  camera.getSnapshot = () => snapshot
  snapshot.frame!.timestamp = 100
  return { camera, snapshot }
}
const selected = {
  token: "example-token",
  box: [0.1, 0.2, 0.4, 0.6],
  label: "Bottle",
}
const matched = {
  status: "matched",
  box: [0.6, 0.3, 0.9, 0.7],
  score: 0.91,
  inliers: 18,
  detectionConfidence: 0.82,
}
function deferred() {
  let resolve!: (value: VisionRecord) => void
  return {
    promise: new Promise<VisionRecord>((accept) => {
      resolve = accept
    }),
    resolve: (value: VisionRecord) => resolve(value),
  }
}

test("select captures Scene and matches only the actual auxiliary result without Eye", async () => {
  const scene = camera(),
    auxiliary = camera()
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select" ? selected : matched,
  })
  await tracker.select(scene.camera, { point: [0.25, 0.4] })
  expect(tracker.getSnapshot().status).toBe("searching")
  expect(tracker.getSnapshot().reference?.box).toEqual([0.1, 0.2, 0.4, 0.6])
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().match?.box).toEqual([0.6, 0.3, 0.9, 0.7])
  expect(tracker.getSnapshot().status).toBe("matched")
  tracker.clear()
})
test("clear during pending selection cleans its late token without restoring a reference", async () => {
  const source = camera(),
    pending = deferred(),
    actions: VisionRequest[] = []
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      actions.push(request)
      return request.action === "select" ? pending.promise : {}
    },
  })
  const selecting = tracker.select(source.camera, { point: [0.2, 0.3] })
  await Promise.resolve()
  tracker.clear()
  pending.resolve(selected)
  await selecting
  expect(tracker.getSnapshot().status).toBe("idle")
  expect(tracker.getSnapshot().reference).toBeNull()
  expect(
    actions.some(
      (request) =>
        request.action === "clear" && request.token === "example-token"
    )
  ).toBe(true)
  tracker.clear()
})
test("an unsuccessful replacement keeps the existing person reference", async () => {
  const source = camera(),
    actions: VisionRequest[] = []
  let selections = 0
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      actions.push(request)
      if (request.action === "select") {
        if (++selections === 1) return selected
        throw new Error("No person detected at that point.")
      }
      return matched
    },
  })
  await tracker.select(source.camera, { point: [0.2, 0.3] })
  await tracker.select(source.camera, { point: [0.9, 0.9] })
  expect(tracker.getSnapshot().reference?.token).toBe(selected.token)
  expect(tracker.getSnapshot().error).toContain("No person")
  expect(actions.filter((request) => request.action === "clear")).toHaveLength(
    0
  )
  source.snapshot.frame!.id++
  await tracker.tick(source.camera, camera().camera)
  expect(tracker.getSnapshot().selectionError).toContain("No person")
  tracker.clear()
})
test("an explicit lost identity latches until reselection and clears movement evidence", async () => {
  const scene = camera(),
    target = camera()
  let targetCalls = 0
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      if (request.action === "select") return selected
      if (request.action === "match") {
        targetCalls++
        return {
          status: "lost",
          requiresReselect: true,
          reason: "Person lock lost. Select again.",
        }
      }
      return matched
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().status).toBe("lost")
  expect(tracker.getSnapshot().match).toBeNull()
  expect(tracker.getSnapshot().reference?.token).toBe(selected.token)
  target.snapshot.frame!.id++
  await tracker.tick(scene.camera, target.camera)
  expect(targetCalls).toBe(1)
  tracker.clear()
})
test("the person leaving Scene retains the reference and an independent ESP-CAM lock", async () => {
  const scene = camera(),
    target = camera()
  let sceneCalls = 0
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      if (request.action === "select") return selected
      if (request.action === "track") {
        sceneCalls++
        return { status: "lost", requiresReselect: true }
      }
      return matched
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  scene.snapshot.frame!.id++
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().sceneStatus).toBe("lost")
  expect(tracker.getSnapshot().requiresReselect).not.toBe(true)
  expect(tracker.getSnapshot().match).not.toBeNull()
  scene.snapshot.frame!.id++
  target.snapshot.frame!.id++
  await tracker.tick(scene.camera, target.camera)
  expect(sceneCalls).toBe(1)
  expect(tracker.getSnapshot().status).toBe("matched")
  tracker.clear()
})
test("matching has backpressure and cannot resurrect a box after clear", async () => {
  const scene = camera(),
    auxiliary = camera(),
    pending = deferred()
  let calls = 0
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      if (request.action === "select") {
        return selected
      }
      if (request.action === "match") {
        calls++
        return pending.promise
      }
      return {}
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  const first = tracker.tick(scene.camera, auxiliary.camera)
  await Promise.resolve()
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(calls).toBe(1)
  tracker.clear()
  pending.resolve(matched)
  await first
  expect(tracker.getSnapshot().match).toBeNull()
  expect(tracker.getSnapshot().status).toBe("idle")
  tracker.clear()
})
test("same-camera frame gaps resume while a real Scene source change invalidates the reference", async () => {
  const scene = camera(),
    auxiliary = camera()
  let now = 100
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => now,
    request: async (request) =>
      request.action === "select" ? selected : matched,
  })
  await tracker.select(scene.camera, { box: [0.1, 0.2, 0.4, 0.6] })
  await tracker.tick(scene.camera, auxiliary.camera)
  now = 1500
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().match).toBeNull()
  expect(tracker.getSnapshot().reference?.label).toBe("Bottle")
  scene.snapshot.frame!.timestamp = auxiliary.snapshot.frame!.timestamp = now
  auxiliary.snapshot.frame!.id++
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().status).toBe("matched")
  scene.snapshot.source!.key = "replacement-camera"
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().reference).toBeNull()
  tracker.clear()
})
test("a network freshness reset preserves selection and the target identity session", async () => {
  const scene = camera(),
    target = camera(),
    streams: number[] = []
  let now = 100
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => now,
    request: async (request) => {
      if (request.action === "select") return selected
      if (request.action === "match") streams.push(request.stream!)
      return matched
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, target.camera)
  now = 1700
  // NetworkCamera invalidates decoded observations at 1.5s of silence. These
  // generations describe fresh frames, not a replacement camera/source.
  for (const stream of [scene.snapshot, target.snapshot]) {
    stream.frame!.generation++
    stream.frame!.id++
    stream.frame!.timestamp = now
  }
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().reference?.token).toBe(selected.token)
  expect(tracker.getSnapshot().match?.generation).toBe(
    target.snapshot.frame!.generation
  )
  expect(streams).toEqual([1, 1])
  tracker.clear()
})
test("a result captured before a network freshness reset cannot renew movement evidence", async () => {
  const scene = camera(),
    target = camera(),
    pending = deferred()
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select"
        ? selected
        : request.action === "match"
          ? pending.promise
          : matched,
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  const work = tracker.tick(scene.camera, target.camera)
  await Promise.resolve()
  target.snapshot.frame!.generation++
  pending.resolve(matched)
  await work
  expect(tracker.getSnapshot().match).toBeNull()
  expect(tracker.getSnapshot().reference?.token).toBe(selected.token)
  tracker.clear()
})
test("a score at 80 percent and malformed geometry never create a matched overlay", async () => {
  const scene = camera(),
    auxiliary = camera()
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select" ? selected : { ...matched, score: 0.8 },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().match).toBeNull()
  expect(tracker.getSnapshot().status).toBe("error")
  tracker.clear()
})

test("a failed response from an old auxiliary source cannot stop tracking its replacement", async () => {
  const scene = camera(),
    auxiliary = camera()
  let fail!: (error: Error) => void
  let calls = 0
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      if (request.action === "select") {
        return selected
      }
      if (request.action === "match") {
        calls++
        if (calls === 1) {
          return new Promise((_, reject) => {
            fail = reject
          })
        }
        return matched
      }
      return {}
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  const pending = tracker.tick(scene.camera, auxiliary.camera)
  await Promise.resolve()
  auxiliary.snapshot.source!.key = "replacement"
  fail(new Error("Old source failed"))
  await pending
  expect(tracker.getSnapshot().status).not.toBe("error")
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().match?.sourceKey).toBe("replacement")
  tracker.clear()
})
test("rotation while Scene has no frame clears its old visual reference", async () => {
  const scene = camera(),
    auxiliary = camera()
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select" ? selected : matched,
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  scene.snapshot.transform = { ...scene.snapshot.transform, rotation: 90 }
  scene.snapshot.frame = null
  await tracker.tick(scene.camera, auxiliary.camera)
  expect(tracker.getSnapshot().reference).toBeNull()
  expect(tracker.getSnapshot().match).toBeNull()
  tracker.clear()
})

test("a stopped viewer server reports connection failure instead of leaving selection without guidance", async () => {
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new TypeError("Failed to fetch")
  )
  try {
    await expect(
      requestVision(
        { action: "select", image: "jpeg", point: [0.2, 0.3] },
        new AbortController().signal
      )
    ).rejects.toThrow("Tracking connection unavailable")
  } finally {
    network.mockRestore()
  }
})

test("Scene selection follows fresh motion even when Target is disconnected", async () => {
  const scene = camera(),
    target = camera()
  target.snapshot.frame = null
  target.snapshot.connection = "idle"
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select"
        ? selected
        : { ...matched, method: "temporal" },
  })
  await tracker.select(scene.camera, { box: [0.1, 0.2, 0.4, 0.6] })
  scene.snapshot.frame!.id++
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().scene?.box).toEqual([0.6, 0.3, 0.9, 0.7])
  expect(tracker.getSnapshot().reference?.box).toEqual([0.1, 0.2, 0.4, 0.6])
  tracker.clear()
})

test("Target temporal following requires a score above 80 percent without inventing geometric inliers", async () => {
  const scene = camera(),
    target = camera()
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select"
        ? selected
        : {
            status: "matched",
            box: [0.5, 0.3, 0.8, 0.7],
            score: 0.9,
            method: "temporal",
          },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().match?.box).toEqual([0.5, 0.3, 0.8, 0.7])
  expect(tracker.getSnapshot().status).toBe("matched")
  tracker.clear()
})

test("Target evidence is timestamped when captured after a slow Scene update", async () => {
  const scene = camera(),
    target = camera(),
    pending = deferred(),
    started = deferred()
  target.camera.getSnapshot = () => ({
    ...target.snapshot,
    frame: target.snapshot.frame ? { ...target.snapshot.frame } : null,
  })
  let now = 100
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => now,
    request: async (request) => {
      if (request.action === "select") return selected
      if (request.action === "track") {
        started.resolve({})
        return pending.promise
      }
      return matched
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  scene.snapshot.frame!.id++
  const analyzing = tracker.tick(scene.camera, target.camera)
  await started.promise
  now = 700
  target.snapshot.frame = { ...target.snapshot.frame!, timestamp: now, id: 2 }
  pending.resolve({ ...matched, method: "temporal" })
  await analyzing
  expect(tracker.getSnapshot().match?.timestamp).toBe(700)
  expect(tracker.getSnapshot().match?.box).toEqual([0.6, 0.3, 0.9, 0.7])
  tracker.clear()
})

test("Target source changes during Scene inference use replacement pixels and a new stream", async () => {
  const scene = camera(),
    target = camera(),
    pending = deferred(),
    started = deferred()
  target.camera.getSnapshot = () => ({
    ...target.snapshot,
    source: target.snapshot.source ? { ...target.snapshot.source } : null,
    frame: target.snapshot.frame ? { ...target.snapshot.frame } : null,
  })
  let delaying = false
  const streams: number[] = []
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) => {
      if (request.action === "select") return selected
      if (request.action === "track" && delaying) {
        started.resolve({})
        return pending.promise
      }
      if (request.action === "match") streams.push(request.stream!)
      return { ...matched, method: "temporal" }
    },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, target.camera)
  delaying = true
  scene.snapshot.frame!.id++
  const analyzing = tracker.tick(scene.camera, target.camera)
  await started.promise
  target.snapshot.source = { ...target.snapshot.source!, key: "replacement" }
  target.snapshot.frame = { ...target.snapshot.frame!, id: 2, generation: 2 }
  pending.resolve({ ...matched, method: "temporal" })
  await analyzing
  expect(streams).toEqual([1, 2])
  expect(tracker.getSnapshot().match?.sourceKey).toBe("replacement")
  expect(tracker.getSnapshot().match?.generation).toBe(2)
  tracker.clear()
})

test("corroborated flow results carry real inliers and update moving Scene and Target boxes", async () => {
  const scene = camera(),
    target = camera()
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select" ? selected : { ...matched, method: "flow" },
  })
  await tracker.select(scene.camera, { box: [0.1, 0.2, 0.4, 0.6] })
  scene.snapshot.frame!.id++
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().scene?.method).toBe("flow")
  expect(tracker.getSnapshot().match?.method).toBe("flow")
  expect(tracker.getSnapshot().scene?.box).toEqual(matched.box)
  tracker.clear()
})

test("a match expires after 500 ms even when no new camera frame arrives", async () => {
  const scene = camera(),
    target = camera()
  let now = 100
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => now,
    request: async (request) =>
      request.action === "select" ? selected : matched,
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().match).not.toBeNull()
  now = 601
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().match).toBeNull()
  expect(tracker.getSnapshot().scene).toBeNull()
  expect(tracker.getSnapshot().lastMatch?.timestamp).toBe(100)
  expect(tracker.getSnapshot().lastScene?.timestamp).toBe(100)
  expect(tracker.getSnapshot().status).toBe("searching")
  expect(tracker.getSnapshot().reference?.token).toBe("example-token")
  tracker.clear()
})

const cursorMeasurement: GazeMeasurement = {
  timestamp: 1000,
  eyeId: 1,
  sceneId: 1,
  eyeTimestamp: 1000,
  sceneTimestamp: 1000,
  confidence: 1,
  position: [0.23, 0.71],
  pixels: [147.2, 340.8],
  valid: true,
  reason: "",
  extrapolated: false,
}

test("gaze selection uses the calibrated scene position, including its offset", () => {
  const state = {
    ...calibrate().s.getSnapshot(),
    measurement: cursorMeasurement,
  }
  expect(sceneGazeCursor(state, liveSnapshot(), true, 1000).point).toEqual([
    0.23, 0.71,
  ])
})

test("gaze selection never substitutes the center for missing, stale or invalid eye evidence", () => {
  const state = {
    ...calibrate().s.getSnapshot(),
    measurement: cursorMeasurement,
  }
  for (const measurement of [
    null,
    { ...cursorMeasurement, timestamp: 499 },
    { ...cursorMeasurement, timestamp: 1001 },
    { ...cursorMeasurement, eyeTimestamp: 499 },
    { ...cursorMeasurement, sceneTimestamp: 499 },
    { ...cursorMeasurement, position: [1.2, 0.5] as const },
    { ...cursorMeasurement, position: [NaN, 0.5] as const },
    { ...cursorMeasurement, valid: false, reason: "Pupil lost" },
  ]) {
    const cursor = sceneGazeCursor(
      { ...state, measurement },
      liveSnapshot(),
      true,
      1000
    )
    expect(cursor.point).toBeNull()
    expect(cursor.message.length).toBeGreaterThan(0)
  }
  expect(sceneGazeCursor(state, liveSnapshot(), false, 1000).point).toBeNull()
  expect(
    sceneGazeCursor({ ...state, calibration: null }, liveSnapshot(), true, 1000)
      .point
  ).toBeNull()
  expect(
    sceneGazeCursor(
      { ...state, capture: "calibration" },
      liveSnapshot(),
      true,
      1000
    ).point
  ).toBeNull()
  expect(
    sceneGazeCursor(
      state,
      { ...liveSnapshot(), connection: "idle" },
      true,
      1000
    ).point
  ).toBeNull()
})

test("an unverified gaze preview stays visibly labeled when used to choose an object", () => {
  const state = {
    ...calibrate().s.getSnapshot(),
    measurement: {
      ...cursorMeasurement,
      valid: false,
      preview: true,
      reason: "Accuracy check required",
    },
  }
  const cursor = sceneGazeCursor(state, liveSnapshot(), true, 1000)
  expect(cursor.point).toEqual(cursorMeasurement.position)
  expect(cursor.message).toMatch(/accuracy|preview/i)
})

test("person matches require identity separation and retain their real evidence scores", async () => {
  const scene = camera(),
    target = camera()
  let margin = 0.2
  const tracker = new ObjectTracking({
    encode: () => "jpeg",
    now: () => 100,
    request: async (request) =>
      request.action === "select"
        ? selected
        : {
            status: "matched",
            method: "person",
            box: matched.box,
            score: 0.71,
            detectionConfidence: 0.9,
            identityMargin: margin,
          },
  })
  await tracker.select(scene.camera, { point: [0.2, 0.3] })
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().match?.score).toBe(0.71)
  expect(tracker.getSnapshot().match?.method).toBe("person")
  margin = 0.01
  scene.snapshot.frame!.id++
  target.snapshot.frame!.id++
  await tracker.tick(scene.camera, target.camera)
  expect(tracker.getSnapshot().match).toBeNull()
  tracker.clear()
})

test("the gaze cursor smooths fixation noise and holds brief gaps visually without allowing selection", () => {
  const cursor = new SceneGazeCursor()
  const state = {
    ...calibrate().s.getSnapshot(),
    measurement: cursorMeasurement,
  }
  const scene = liveSnapshot()
  const first = cursor.read(state, scene, true, 1000)
  const jitter = {
    ...cursorMeasurement,
    timestamp: 1050,
    eyeTimestamp: 1050,
    sceneTimestamp: 1050,
    position: [0.24, 0.72] as const,
  }
  const next = cursor.read({ ...state, measurement: jitter }, scene, true, 1050)
  expect(next.point![0]).toBeGreaterThan(first.point![0])
  expect(next.point![0]).toBeLessThan(0.24)
  const missing = {
    ...state,
    measurement: { ...jitter, position: null, valid: false },
  }
  const paused = cursor.read(missing, scene, true, 1150)
  expect(paused.point).toBeNull()
  expect(paused.displayPoint).toEqual(next.displayPoint)
  expect(paused.held).toBe(true)
  expect(cursor.read(missing, scene, true, 1451).displayPoint).toBeNull()
  expect(cursor.read(state, scene, false, 1050).displayPoint).toBeNull()
})
