import { loadOpenCv } from "../eye-tracking/opencv"
import { MarkerDetector } from "./marker-detector"
import type { MarkerWorkerReply, MarkerWorkerRequest } from "./marker-tracker"
let detector: MarkerDetector | null = null
let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null
let generation = -1
const send = (message: MarkerWorkerReply) => self.postMessage(message)
self.onmessage = async (event: MessageEvent<MarkerWorkerRequest>) => {
  const message = event.data
  try {
    if (message.type === "init") {
      generation = message.generation
      if (typeof OffscreenCanvas === "undefined") {
        throw new Error(
          "Marker tracking needs OffscreenCanvas. Use a current browser."
        )
      }
      canvas = new OffscreenCanvas(1, 1)
      context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context) {
        throw new Error(
          "The marker worker cannot read scene camera pixels in this browser."
        )
      }
      const { cv } = await loadOpenCv()
      if (message.generation !== generation) {
        return
      }
      detector = new MarkerDetector(cv)
      send({ type: "ready", generation })
    } else if (message.type === "frame") {
      try {
        if (message.generation !== generation) {
          return
        }
        if (!detector || !canvas || !context) {
          throw new Error("The marker detector has not loaded yet.")
        }
        const { width, height } = message.bitmap
        if (canvas.width !== width) {
          canvas.width = width
        }
        if (canvas.height !== height) {
          canvas.height = height
        }
        context.drawImage(message.bitmap, 0, 0)
        const image = context.getImageData(0, 0, width, height)
        send({
          type: "result",
          generation,
          marker: detector.detect(image, message.scene),
        })
      } finally {
        message.bitmap.close()
      }
    }
  } catch (error) {
    send({
      type: "error",
      generation: message.generation,
      error:
        error instanceof Error ? error.message : "Marker detection failed.",
    })
  }
}
