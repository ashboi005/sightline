import { useEffect, useRef, type MutableRefObject } from "react"
import { drawCameraFrame, isDefaultCameraTransform } from "./camera-transform"
import type { TrackingFrame } from "./eye-tracking.types"
import { shouldIncludePreviewMasks } from "./preview-mask-policy"
import { drawSample } from "./sample"
import type { WorkerRequest, WorkerResponse } from "./tracker.worker.types"
import type { UseTrackerWorkerCallbacks } from "./use-tracker-worker.types"
import type { TrackerRuntime } from "./use-tracker.types"
import { VideoFrameClock } from "./video-frame-clock"
export function useTrackerWorker(
  runtime: TrackerRuntime,
  sourceCanvas: MutableRefObject<HTMLCanvasElement | null>,
  callbacks: UseTrackerWorkerCallbacks
): void {
  const workerInputs = useRef({ runtime, sourceCanvas, callbacks })
  useEffect(() => {
    const { control, latest } = workerInputs.current.runtime
    const sourceCanvas = workerInputs.current.sourceCanvas
    const { clearFrame, setEngineReady, setError, setFrame, stop } =
      workerInputs.current.callbacks
    const c = control.current
    const frameClock = new VideoFrameClock()
    const worker = new Worker(new URL("./tracker.worker.ts", import.meta.url), {
      type: "module",
    })
    c.worker = worker
    let requestSourceEpoch = c.sourceEpoch
    const fail = (message: string) => {
      c.ready = false
      c.inflight = false
      c.inflightGeneration = -1
      setEngineReady(false)
      setError(message)
      stop()
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === "ready") {
        c.ready = true
        setEngineReady(true)
        return
      }
      if (
        message.generation !== undefined &&
        message.generation !== c.generation
      ) {
        if (message.generation === c.inflightGeneration) {
          c.inflight = false
          c.inflightGeneration = -1
        }
        return
      }
      c.inflight = false
      c.inflightGeneration = -1
      if (
        message.generation !== undefined &&
        requestSourceEpoch !== c.sourceEpoch
      ) {
        return
      }
      if (message.type === "error") {
        fail(message.message)
        return
      }
      if (message.type === "frame") {
        if (
          c.source?.kind === "network" &&
          (!c.networkFrame || message.frame.timestamp < c.networkInterruptedAt)
        ) {
          return
        }
        const canvas = sourceCanvas.current
        if (canvas) {
          canvas
            .getContext("2d")
            ?.putImageData(
              new ImageData(
                message.data,
                message.frame.width,
                message.frame.height
              ),
              0,
              0
            )
        }
        if (!c.previewMasksEnabled) {
          previewMasks.clear()
          previewMaskGeneration = message.generation
        } else if (previewMaskGeneration !== message.generation) {
          previewMaskGeneration = message.generation
          previewMasks.clear()
        }
        const previews = message.frame.detection.previews.map(
          (preview: TrackingFrame["detection"]["previews"][number]) => {
            if (!c.previewMasksEnabled) {
              if (!preview.mask) {
                return preview
              }
              return {
                label: preview.label,
                threshold: preview.threshold,
                method: preview.method,
                score: preview.score,
              }
            }
            const key = `${preview.method ?? "global"}:${preview.label}`
            if (preview.mask) {
              previewMasks.set(key, preview.mask)
            }
            const mask = preview.mask ?? previewMasks.get(key)
            return mask && !preview.mask ? { ...preview, mask } : preview
          }
        )
        const frame = {
          ...message.frame,
          detection: { ...message.frame.detection, previews },
        } as TrackingFrame
        latest.current = frame
        setFrame(frame)
      }
    }
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault()
      fail(
        event.message
          ? `The vision engine stopped: ${event.message}`
          : "The vision engine stopped unexpectedly. Restart the camera and try again."
      )
    }
    worker.onmessageerror = () =>
      fail("The vision engine returned data the page could not read.")
    const sampleCanvas = document.createElement("canvas")
    const captureCanvas = document.createElement("canvas")
    const previewMasks = new Map<string, Uint8Array>()
    let raf = 0
    let last = 0
    let lastPreviewMaskFrame = -Infinity
    let previewMaskRequestGeneration = -1
    let previewMaskGeneration = -1
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop)
      if (!c.source || !c.ready || c.inflight || time - last < 1000 / 24) {
        return
      }
      const display = sourceCanvas.current
      if (!display) {
        return
      }
      const canvas = captureCanvas
      if (canvas.width !== display.width || canvas.height !== display.height) {
        canvas.width = display.width
        canvas.height = display.height
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) {
        return
      }
      let timestamp = time
      if (c.source.kind === "sample") {
        if (isDefaultCameraTransform(c.transform)) {
          drawSample(ctx, time, c.sampleTarget, c.blink)
        } else {
          sampleCanvas.width = c.inputDimensions.width
          sampleCanvas.height = c.inputDimensions.height
          const sampleCtx = sampleCanvas.getContext("2d")
          if (!sampleCtx) {
            return
          }
          drawSample(sampleCtx, time, c.sampleTarget, c.blink)
          drawCameraFrame(
            ctx,
            sampleCanvas,
            sampleCanvas.width,
            sampleCanvas.height,
            c.transform,
            canvas
          )
        }
      } else if (c.source.kind === "network") {
        const frame = c.networkFrame
        if (
          !frame ||
          frame.sequence === c.lastNetworkSequence ||
          time - frame.timestamp > 700
        ) {
          if (latest.current && time - latest.current.timestamp > 700) {
            clearFrame()
          }
          return
        }
        c.lastNetworkSequence = frame.sequence
        timestamp = frame.timestamp
        drawCameraFrame(
          ctx,
          frame.image,
          frame.width,
          frame.height,
          c.transform,
          canvas
        )
      } else {
        if (
          !c.video ||
          c.video.readyState < 2 ||
          c.video.currentTime === c.lastVideoTime
        ) {
          if (latest.current && time - latest.current.timestamp > 700) {
            clearFrame()
          }
          return
        }
        c.lastVideoTime = c.video.currentTime
        frameClock.watch(c.video)
        timestamp = frameClock.read(time)
        drawCameraFrame(
          ctx,
          c.video,
          c.video.videoWidth,
          c.video.videoHeight,
          c.transform,
          canvas
        )
      }
      last = time
      if (previewMaskRequestGeneration !== c.generation) {
        previewMaskRequestGeneration = c.generation
        lastPreviewMaskFrame = -Infinity
      }
      // Segmentation runs every frame; the large visualization masks need only
      // refresh five times per second.
      const includePreviewMasks = shouldIncludePreviewMasks(
        c.previewMasksEnabled,
        time,
        lastPreviewMaskFrame
      )
      if (includePreviewMasks) {
        lastPreviewMaskFrame = time
      }
      const request: WorkerRequest = {
        type: "frame",
        data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        width: canvas.width,
        height: canvas.height,
        settings: c.settings,
        id: ++c.sequence,
        timestamp,
        generation: c.generation,
        includePreviewMasks,
      }
      c.inflight = true
      c.inflightGeneration = c.generation
      requestSourceEpoch = c.sourceEpoch
      worker.postMessage(request, [request.data.buffer])
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      frameClock.stop()
      worker.terminate()
      c.inflight = false
      c.inflightGeneration = -1
      c.ready = false
      c.worker = null
      c.generation++
      c.sourceEpoch++
      c.network?.stop()
      c.network = null
      c.networkFrame = null
      c.stream?.getTracks().forEach((t) => t.stop())
      c.video?.pause()
      if (c.video) {
        c.video.srcObject = null
      }
      if (c.url) {
        URL.revokeObjectURL(c.url)
      }
    }
  }, [workerInputs])
}
