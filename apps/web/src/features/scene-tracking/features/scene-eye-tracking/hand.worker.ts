import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision"
import type { HandWorkerRequest } from "./hand.worker.types"
// Compiled as a classic worker: MediaPipe 0.10.32 loads its WASM factory with importScripts.
let detector: HandLandmarker | null = null
let delegate: "GPU" | "CPU" = "GPU"
const base = new URL(".", self.location.href).href
const send = (message: object) => self.postMessage(message)
async function initialize(generation: number) {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error(
      "Hand tracking needs OffscreenCanvas. Use a current Chrome, Edge, Firefox or Safari browser."
    )
  }
  const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
  const canvas = new OffscreenCanvas(640, 480)
  const options = {
    baseOptions: {
      modelAssetPath: new URL("../models/hand_landmarker.task", base).href,
      delegate: "GPU" as "GPU" | "CPU",
    },
    canvas,
    runningMode: "VIDEO" as const,
    // Tracking one calibration hand lets MediaPipe skip palm detection while
    // it remains visible. Looking for a second hand runs that detector again.
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }
  try {
    delegate = "GPU"
    detector = await HandLandmarker.createFromOptions(fileset, options)
  } catch {
    delegate = "CPU"
    detector?.close()
    detector = await HandLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    })
  }
  send({ type: "ready", generation, delegate })
}
self.onmessage = async (event: MessageEvent<HandWorkerRequest>) => {
  const message = event.data
  try {
    if (message.type === "init") {
      detector?.close()
      detector = null
      await initialize(message.generation)
    } else if (message.type === "frame") {
      try {
        if (!detector) {
          throw new Error("The hand detector has not loaded yet.")
        }
        const started = performance.now()
        const result = detector.detectForVideo(
          message.bitmap,
          message.scene.timestamp
        )
        send({
          type: "result",
          generation: message.generation,
          scene: message.scene,
          inferenceMs: performance.now() - started,
          landmarks: result.landmarks,
          worldLandmarks: result.worldLandmarks,
          handedness: result.handedness.map(
            (categories) => categories[0]?.categoryName ?? "Unknown"
          ),
        })
      } finally {
        message.bitmap.close()
      }
    }
  } catch (error) {
    send({
      type: "error",
      generation: message.generation,
      error: error instanceof Error ? error.message : "Hand detection failed.",
    })
  }
}
