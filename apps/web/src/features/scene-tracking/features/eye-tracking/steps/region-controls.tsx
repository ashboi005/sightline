import { Check, Maximize } from "lucide-react"
import { useState } from "react"
import {
  EyeFieldStyles,
  EyeGuidanceRowStyles,
  EyeNumberGridStyles,
} from "../../tracking-ui/control-styles"
import { EyeRoiCoordinatesStyles } from "../../tracking-ui/camera-styles"
import { EyeActionButton } from "../components/eye-action-button"
import { HelpTip } from "../components/help-tip"
import type { Rect } from "../eye-tracking.types"
import { clampRegion, MIN_REGION_SIZE } from "../roi"
import type { RegionControlsProps, RegionDraft } from "./region-controls.types"
const REGION_FIELD_LABELS = {
  x: "Left",
  y: "Top",
  width: "Width",
  height: "Height",
} as const
export function RegionControls({ tracker, chooseRegion }: RegionControlsProps) {
  const roi = tracker.settings.roi
  const [edit, setEdit] = useState<RegionDraft | null>(null)
  const values =
    edit?.original === roi
      ? edit.values
      : {
          x: String(roi.x),
          y: String(roi.y),
          width: String(roi.width),
          height: String(roi.height),
        }
  const next = clampRegion(
    {
      x: Number(values.x),
      y: Number(values.y),
      width: Number(values.width),
      height: Number(values.height),
    },
    tracker.dimensions
  )
  const changed =
    next.x !== roi.x ||
    next.y !== roi.y ||
    next.width !== roi.width ||
    next.height !== roi.height
  const dirty = Object.keys(values).some(
    (key) => values[key as keyof Rect] !== String(roi[key as keyof Rect])
  )
  const minimums = {
    x: 0,
    y: 0,
    width: Math.min(MIN_REGION_SIZE, tracker.dimensions.width),
    height: Math.min(MIN_REGION_SIZE, tracker.dimensions.height),
  }
  return (
    <>
      <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
        <EyeActionButton
          label="Use the full camera frame"
          onClick={() => chooseRegion({ x: 0, y: 0, ...tracker.dimensions })}
        >
          <Maximize size={16} aria-hidden="true" />
        </EyeActionButton>
        <HelpTip
          label="Region editing tips"
          text="Drag inside to move; drag handles to resize. Redraw creates a new box. Arrow keys move, Shift + arrows resize, Alt uses 10-pixel steps. Escape cancels a drag."
        />
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (changed) {
            chooseRegion(next)
          }
          setEdit(null)
        }}
      >
        <div
          className={`eye-number-grid ${EyeNumberGridStyles} eye-roi-coordinates ${EyeRoiCoordinatesStyles}`}
        >
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label className={`eye-field ${EyeFieldStyles}`} key={key}>
              {REGION_FIELD_LABELS[key]} · px
              <input
                type="number"
                value={values[key]}
                step={1}
                aria-label={`ROI ${key}`}
                min={minimums[key]}
                max={
                  key === "x" || key === "width"
                    ? tracker.dimensions.width
                    : tracker.dimensions.height
                }
                onChange={(event) =>
                  setEdit({
                    original: roi,
                    values: { ...values, [key]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
        <EyeActionButton
          label="Apply coordinates"
          type="submit"
          disabled={!dirty}
        >
          <Check size={17} aria-hidden="true" />
        </EyeActionButton>
      </form>
    </>
  )
}
