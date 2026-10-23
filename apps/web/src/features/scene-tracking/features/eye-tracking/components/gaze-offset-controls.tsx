import { Crosshair, RotateCcw } from "lucide-react"
import { EyeActionButton } from "./eye-action-button"
import type { GazeOffsetControlsProps } from "./gaze-offset-controls.types"

export function GazeOffsetControls({
  offset,
  width,
  height,
  disabled = false,
  onChange,
  onCorrect,
}: GazeOffsetControlsProps) {
  const unavailable =
    disabled ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  return (
    <div
      className="flex items-center gap-2 border-t border-white/15 py-3"
      aria-label="Gaze position adjustment"
    >
      <span className="mr-auto text-xs text-white/60">Gaze offset</span>
      <EyeActionButton
        label="Correct gaze with a click"
        disabled={unavailable}
        onClick={onCorrect}
      >
        <Crosshair className="shrink-0" size={17} aria-hidden="true" />
      </EyeActionButton>
      <EyeActionButton
        label="Reset gaze offset"
        disabled={unavailable || offset.every((value) => value === 0)}
        onClick={() => onChange([0, 0])}
      >
        <RotateCcw className="shrink-0" size={17} aria-hidden="true" />
      </EyeActionButton>
    </div>
  )
}
