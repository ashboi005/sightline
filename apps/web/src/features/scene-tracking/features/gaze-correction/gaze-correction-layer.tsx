import { Crosshair, RotateCcw, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { EyeActionButton } from "../eye-tracking/components/eye-action-button"
import { correctionTarget, GazeCorrectionSampler } from "./gaze-correction"
import type { GazeCorrectionLayerProps } from "./gaze-correction-layer.types"

/** Explicit target correspondence: user looks at a target and clicks its location. */
export function GazeCorrectionLayer({
  point,
  timestamp,
  offset,
  resetKey,
  imageSize,
  options,
}: GazeCorrectionLayerProps) {
  const surface = useRef<HTMLDivElement>(null)
  const sampler = useRef(new GazeCorrectionSampler())
  const request = options.request ?? 0
  const [active, setActive] = useState(
    Boolean(options.initiallyActive || request > 0)
  )
  const [message, setMessage] = useState("")
  const offsetX = offset[0]
  const offsetY = offset[1]
  const imageWidth = imageSize?.width
  const imageHeight = imageSize?.height
  const x = point?.[0]
  const y = point?.[1]

  const [context, setContext] = useState({
    resetKey,
    offsetX,
    offsetY,
    imageWidth,
    imageHeight,
    request,
  })
  const contextChanged =
    context.resetKey !== resetKey ||
    context.offsetX !== offsetX ||
    context.offsetY !== offsetY ||
    context.imageWidth !== imageWidth ||
    context.imageHeight !== imageHeight ||
    context.request !== request
  if (contextChanged) {
    setContext({ resetKey, offsetX, offsetY, imageWidth, imageHeight, request })
    setActive(context.request !== request && request > 0)
    if (context.request !== request || context.resetKey !== resetKey) {
      setMessage("")
    }
  }
  useEffect(() => {
    sampler.current.clear()
  }, [resetKey, offsetX, offsetY, imageWidth, imageHeight, request])

  useEffect(() => {
    const element = surface.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(() => sampler.current.clear())
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active) {
      sampler.current.clear()
      return
    }
    if (x === undefined || y === undefined) {
      sampler.current.add(null, null)
    } else {
      sampler.current.add([x, y], timestamp)
    }
  }, [active, x, y, timestamp])

  useEffect(() => {
    if (!active) {
      return
    }
    function cancel(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setActive(false)
        setMessage("")
      }
    }
    document.addEventListener("keydown", cancel, true)
    return () => document.removeEventListener("keydown", cancel, true)
  }, [active])

  const instruction = imageSize
    ? "Look at the real object. Click its position in this image."
    : "Look at a target. Click that target to correct gaze."

  return (
    <div ref={surface} className="pointer-events-none absolute inset-0">
      {active && (
        <button
          type="button"
          aria-label="Click the target to correct gaze"
          className="pointer-events-auto absolute inset-0 cursor-crosshair bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a5d5c5]"
          onPointerDown={(event) => {
            if (event.button !== 0 || !surface.current) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            const bounds = surface.current.getBoundingClientRect()
            const target = correctionTarget(
              [event.clientX, event.clientY],
              bounds,
              imageSize
            )
            if (!target) {
              setMessage("Click inside the camera image.")
              return
            }
            const result = sampler.current.correct(
              target,
              offset,
              performance.now(),
              options.maxAgeMs
            )
            if (!result.offset) {
              setMessage(result.error)
              return
            }
            options.onChange(result.offset)
            sampler.current.clear()
            setActive(false)
            setMessage("Offset corrected. Check accuracy before relying on it.")
          }}
        />
      )}
      <div className="pointer-events-auto absolute top-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg border border-white/15 bg-[#121512]/95 p-1">
        <EyeActionButton
          label={
            active ? "Cancel gaze correction (Esc)" : "Correct gaze offset"
          }
          aria-pressed={active}
          onClick={() => {
            sampler.current.clear()
            setActive(!active)
            setMessage("")
          }}
        >
          {active ? (
            <X className="shrink-0" size={17} />
          ) : (
            <Crosshair className="shrink-0" size={17} />
          )}
        </EyeActionButton>
        <EyeActionButton
          label="Reset gaze offset"
          disabled={offsetX === 0 && offsetY === 0}
          onClick={() => {
            sampler.current.clear()
            setActive(false)
            setMessage("")
            options.onChange([0, 0])
          }}
        >
          <RotateCcw className="shrink-0" size={17} />
        </EyeActionButton>
      </div>
      {(active || message) && (
        <div
          className="absolute top-16 left-1/2 w-max max-w-[90%] -translate-x-1/2 rounded-md bg-black/85 px-3 py-2 text-center text-xs text-white"
          role="status"
        >
          {message || instruction}
        </div>
      )}
    </div>
  )
}
