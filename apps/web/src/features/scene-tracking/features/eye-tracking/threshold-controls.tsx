import { SlidersHorizontal, WandSparkles } from "lucide-react"
import { useState, type CSSProperties } from "react"
import {
  EyeThresholdControlRowStyles,
  EyeThresholdControlsStyles,
  EyeThresholdFieldLabelStyles,
  EyeThresholdHeadingStyles,
  EyeThresholdModesStyles,
  EyeThresholdSliderStyles,
  EyeThresholdTitleStyles,
  EyeThresholdTuningStyles,
  EyeThresholdValueStyles,
} from "../tracking-ui/threshold-styles"
import { HelpTip } from "./components/help-tip"
import type { ThresholdControlsProps } from "./threshold-controls.types"
export function ThresholdControls({ tracker, update }: ThresholdControlsProps) {
  const { settings, frame } = tracker
  const spatial = settings.format === "spatial"
  const manual = !spatial || settings.thresholdMode === "manual"
  const [draft, setDraft] = useState<number | null>(null)
  const minimum = manual ? 0 : -50
  const maximum = manual ? 255 : 80
  const value = draft ?? settings.threshold
  const progress = ((value - minimum) / (maximum - minimum)) * 100
  const selected = frame?.detection.previews[frame.detection.selected]
  const commit = () => {
    if (draft !== null && draft !== settings.threshold) {
      update({ threshold: Math.max(minimum, Math.min(maximum, draft)) })
    }
    setDraft(null)
  }
  return (
    <section
      className={`eye-threshold-controls ${EyeThresholdControlsStyles}`}
      aria-label="Threshold adjustment"
    >
      <div className={`eye-threshold-heading ${EyeThresholdHeadingStyles}`}>
        <div className={`eye-threshold-title ${EyeThresholdTitleStyles}`}>
          <strong>Threshold</strong>
        </div>
        <HelpTip
          label="Threshold help"
          text={
            manual
              ? "Adjust the pupil cutoff: 0 is dark, 255 is light."
              : "Auto follows the pupil rim. Bias makes the cutoff darker or lighter."
          }
        />
      </div>
      <div className={`eye-threshold-tuning ${EyeThresholdTuningStyles}`}>
        {spatial && (
          <div
            className={`eye-threshold-modes ${EyeThresholdModesStyles}`}
            role="group"
            aria-label="Threshold mode"
          >
            <button
              aria-label="Auto threshold"
              title="Automatic threshold"
              data-tooltip="Automatic threshold"
              aria-pressed={!manual}
              onClick={() => {
                if (!manual) {
                  return
                }
                setDraft(null)
                update({ thresholdMode: "auto", threshold: 0 })
              }}
            >
              <WandSparkles size={16} aria-hidden="true" />
            </button>
            <button
              aria-label="Manual threshold"
              title="Manual threshold"
              data-tooltip="Manual threshold"
              aria-pressed={manual}
              onClick={() => {
                if (manual) {
                  return
                }
                setDraft(null)
                update({
                  thresholdMode: "manual",
                  threshold: selected?.threshold ?? 50,
                })
              }}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <div
          className={`eye-threshold-control-row ${EyeThresholdControlRowStyles}`}
        >
          <label
            className={`eye-threshold-field-label ${EyeThresholdFieldLabelStyles}`}
            htmlFor="eye-threshold-range"
          >
            {manual ? "Cutoff" : "Bias"}
          </label>
          <input
            id="eye-threshold-range"
            className={`eye-threshold-slider ${EyeThresholdSliderStyles}`}
            type="range"
            aria-label={manual ? "Pupil threshold" : "Auto threshold bias"}
            aria-valuetext={
              manual ? `${value} dark-pupil cutoff` : `Automatic bias ${value}`
            }
            min={minimum}
            max={maximum}
            value={value}
            style={{ "--threshold-progress": `${progress}%` } as CSSProperties}
            onInput={(event) => {
              setDraft(null)
              update({ threshold: Number(event.currentTarget.value) })
            }}
          />
          <input
            className={`eye-threshold-value ${EyeThresholdValueStyles}`}
            type="number"
            aria-label="Threshold value"
            min={minimum}
            max={maximum}
            value={value}
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              setDraft(Number.isFinite(next) ? next : 0)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit()
              }
            }}
          />
        </div>
      </div>
    </section>
  )
}
