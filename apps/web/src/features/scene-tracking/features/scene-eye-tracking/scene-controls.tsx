import {
  Crosshair,
  Download,
  LoaderCircle,
  LockKeyhole,
  PauseCircle,
  Play,
  Plug,
  RefreshCw,
  Unplug,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { CameraSourceType } from "../eye-tracking/components/camera-source-type"
import { GazeOffsetControls } from "../eye-tracking/components/gaze-offset-controls"
import { SavedCameraOption } from "../eye-tracking/components/saved-camera-option"
import { useCameraSourcePreferences } from "../eye-tracking/use-camera-source-preferences"
import { CameraSpinnerStyles } from "../tracking-ui/camera-styles"
import {
  EyeActionIconStyles,
  EyeButtonStyles,
  EyeFieldStyles,
  EyeMutedStyles,
  EyeSourceActionsStyles,
} from "../tracking-ui/control-styles"
import {
  SceneCalibrationInstructionStyles,
  SceneCaptureCountStyles,
  SceneEstimatedLabelStyles,
  SceneHoldStatusStyles,
  SceneInstructionStyles,
  SceneMetricsStyles,
  SceneOffsetFieldsStyles,
  SceneProjectionControlsStyles,
} from "../tracking-ui/scene-styles"
import { CalibrationMethodControls } from "./calibration-method-controls"
import { sceneRegionLabel } from "./calibration"
import { download } from "./download"
import { markerSvg } from "./marker-detector"
import type {
  FingerControlsProps,
  SceneLiveControlsProps,
  SceneOffsetInput,
  SceneSourceControlsProps,
} from "./scene-controls.types"
import { hasCurrentAccuracyCheck } from "./scene-session"
import { useCalibrationFeedback } from "./use-calibration-feedback"
import { ValidationRecoveryControls } from "./validation-recovery-controls"
const SOUND_HELP =
  "Low tone: stable lock. Continuous tone: collecting samples. Short buzz: tracking interrupted. Rising double tone: point saved."
export function SceneSourceControls({
  camera,
  state,
  eyeDeviceId,
  onConnected,
  active = true,
}: SceneSourceControlsProps) {
  const advanceOnConnect = useRef(false)
  const { kind, setKind, url, setUrl, deviceId, setDeviceId } =
    useCameraSourcePreferences("scene", state.source)
  useEffect(() => {
    if (!active) {
      advanceOnConnect.current = false
      return
    }
    if (
      advanceOnConnect.current &&
      state.source &&
      state.connection === "live"
    ) {
      advanceOnConnect.current = false
      onConnected()
    }
  }, [active, onConnected, state.connection, state.source])
  let connectLabel = state.source ? "Reconnect" : "Connect"
  if (state.busy) {
    connectLabel = "Connecting…"
  }
  if (state.connection === "reconnecting") {
    connectLabel = "Reconnecting…"
  }
  let ConnectionIcon = state.source ? RefreshCw : Plug
  if (state.busy) {
    ConnectionIcon = LoaderCircle
  }
  async function connect() {
    advanceOnConnect.current = true
    if (kind === "usb") {
      await camera.startCamera(deviceId, eyeDeviceId)
    } else {
      await camera.startNetworkStream(url)
    }
  }
  return (
    <>
      <CameraSourceType
        value={kind}
        onChange={setKind}
        label="Scene camera type"
      />
      {kind === "usb" ? (
        <label className={`eye-field ${EyeFieldStyles}`}>
          <select
            aria-label="Scene camera"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            <option value="">Default camera</option>
            <SavedCameraOption deviceId={deviceId} devices={state.devices} />
            {state.devices.map((d, i) => (
              <option
                key={d.deviceId || i}
                value={d.deviceId}
                disabled={!!eyeDeviceId && d.deviceId === eyeDeviceId}
              >
                {d.label.trim() || `Camera ${i + 1}`}
                {d.deviceId === eyeDeviceId ? " (eye camera)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className={`eye-field ${EyeFieldStyles}`}>
          <input
            aria-label="Scene stream URL"
            type="url"
            placeholder="http://esp32cam.local:81/stream"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      )}
      <div className={`eye-source-actions ${EyeSourceActionsStyles}`}>
        <button
          className={`eye-button ${EyeButtonStyles} primary`}
          disabled={state.busy || (kind === "network" && !url.trim())}
          onClick={() => void connect()}
        >
          <ConnectionIcon
            className={
              state.busy ? `camera-spinner ${CameraSpinnerStyles}` : undefined
            }
            size={16}
            aria-hidden="true"
          />
          {connectLabel}
        </button>
        {(state.source || state.busy) && (
          <button
            className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
            aria-label={
              state.busy ? "Cancel connection" : "Disconnect scene camera"
            }
            title={state.busy ? "Cancel connection" : "Disconnect scene camera"}
            data-tooltip={state.busy ? "Cancel connection" : "Disconnect"}
            onClick={() => {
              advanceOnConnect.current = false
              camera.stop()
            }}
          >
            {state.busy ? (
              <X size={17} aria-hidden="true" />
            ) : (
              <Unplug size={17} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </>
  )
}
export function FingerControls({
  onCorrect,
  session,
  state,
  hands,
  canCapture,
  retry,
  onLive,
}: FingerControlsProps) {
  const marker = state.method === "marker"
  const onePoint = state.method === "one-point"
  const calibrationCount = onePoint ? 1 : 9
  const required = state.capture === "validation" ? 5 : calibrationCount
  const done = state.collection?.holds.length ?? 0
  const finishing = useRef(false)
  useEffect(() => {
    if (state.capture) {
      finishing.current = true
      return
    }
    if (finishing.current) {
      finishing.current = false
      if (state.calibration && (state.validation?.passed || onePoint)) {
        onLive()
      }
    }
  }, [state.capture, state.calibration, state.validation, onePoint, onLive])
  const feedback = useCalibrationFeedback(session)
  const prepareSound = feedback.prepare
  const paused = state.collection?.status === "paused"
  let trackerNotice = hands.error || "Waiting for the scene camera."
  if (hands.status === "loading") {
    trackerNotice = marker
      ? "Loading marker tracking…"
      : "Loading hand tracking…"
  }
  let captureLabel = "Lock point"
  let CaptureIcon = LockKeyhole
  if (state.collection?.armed) {
    CaptureIcon = paused ? PauseCircle : LoaderCircle
    captureLabel = "Capturing…"
    if (paused) {
      captureLabel = "Paused"
    } else if (state.collection.status === "settling") {
      captureLabel = "Settling…"
    }
  }
  useEffect(() => {
    if ((!state.capture && !onePoint) || marker) {
      return
    }
    const lock = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (element?.closest(
          "input, textarea, select, button, a, [contenteditable]"
        ) &&
          !element.closest("[data-calibration-shortcut]"))
      ) {
        return
      }
      event.preventDefault()
      if (canCapture) {
        prepareSound()
        if (!state.capture && onePoint) {
          session.startCapture("calibration")
        }
        session.lockPoint()
      }
    }
    window.addEventListener("keydown", lock)
    return () => window.removeEventListener("keydown", lock)
  }, [canCapture, prepareSound, session, state.capture, marker, onePoint])
  const captureShortcutHint =
    onePoint && state.capture !== "validation"
      ? "Space captures once."
      : "Space locks a point."
  const captureStageLabel =
    state.capture === "validation" ? "Accuracy check" : "Calibration"
  const collectionHint = marker
    ? state.collection?.hint
        .replaceAll("fingertip", "marker")
        .replaceAll("Fingertip", "Marker")
        .replaceAll("hand", "marker")
        .replace("Press Space to lock.", "Pause to capture.")
    : state.collection?.hint
  const captureButtonTitle = paused
    ? "Waiting for fresh tracking. Resumes automatically."
    : "Look at your physical fingertip, then lock this point"
  const captureIconClassName =
    state.collection?.armed && !paused
      ? `camera-spinner ${CameraSpinnerStyles}`
      : undefined
  const retryIndex = state.fitFailure?.retryIndex
  const retryHold =
    retryIndex != null ? state.fitFailure?.holds[retryIndex] : null
  let calibrationActionLabel = state.calibration ? "Recalibrate" : "Calibrate"
  if (retryHold) {
    calibrationActionLabel = `Retry ${sceneRegionLabel(retryHold.region).toLowerCase()}`
  }
  const CalibrationActionIcon = retryHold ? RefreshCw : Crosshair
  const dimensions = state.calibration?.holds[0]?.pairs[0]
  return (
    <>
      <CalibrationMethodControls
        value={state.method}
        onChange={(method) => session.setMethod(method)}
        disabled={!!state.capture}
      />
      {dimensions &&
        !state.capture &&
        (!state.validation || state.validation.passed) && (
          <GazeOffsetControls
            onCorrect={onCorrect}
            offset={state.offset}
            width={dimensions.width}
            height={dimensions.height}
            onChange={(offset) => session.setOffset(offset)}
          />
        )}
      <div
        className={`scene-calibration-instruction ${SceneCalibrationInstructionStyles}`}
      >
        <p className={`scene-instruction ${SceneInstructionStyles}`}>
          {marker ? (
            <>
              Look at the <strong>red center</strong>. Move your head; pause for
              each tone.
            </>
          ) : (
            <>
              Look at your <strong>physical fingertip</strong>.{" "}
              {captureShortcutHint}
            </>
          )}
        </p>
        <button
          className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
          aria-label={
            feedback.enabled
              ? "Mute calibration sounds"
              : "Enable calibration sounds"
          }
          aria-pressed={feedback.enabled}
          title={SOUND_HELP}
          data-tooltip={SOUND_HELP}
          onClick={feedback.toggle}
        >
          {feedback.enabled ? (
            <Volume2 size={16} aria-hidden="true" />
          ) : (
            <VolumeX size={16} aria-hidden="true" />
          )}
        </button>
        {marker && (
          <button
            className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
            aria-label="Download printable calibration marker"
            title="Optional printed copy · use matte paper at your working distance"
            data-tooltip="Optional printed copy"
            onClick={() =>
              download(
                new Blob([markerSvg()], { type: "image/svg+xml" }),
                "sightline-calibration-marker.svg"
              )
            }
          >
            <Download size={16} aria-hidden="true" />
          </button>
        )}
        {state.fitFailure && (
          <button
            className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
            aria-label="Download calibration diagnostics"
            title="Save the failed samples and point errors on this device"
            data-tooltip="Calibration diagnostics"
            onClick={() =>
              download(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        version: 1,
                        delayMs: state.delayMs,
                        ...state.fitFailure,
                      },
                      null,
                      2
                    ),
                  ],
                  { type: "application/json" }
                ),
                "scene-calibration-diagnostics.json"
              )
            }
          >
            <Download size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {onePoint && (
        <small className={`scene-estimated-label ${SceneEstimatedLabelStyles}`}>
          Experimental · accuracy not measured
        </small>
      )}
      {hands.status !== "ready" && !state.capture && (
        <p role="status">{trackerNotice}</p>
      )}
      {hands.status === "error" && (
        <button
          className={`eye-button ${EyeButtonStyles} secondary`}
          onClick={retry}
        >
          <RefreshCw size={16} aria-hidden="true" /> Retry
        </button>
      )}
      {state.validation && !state.validation.passed && !state.capture && (
        <ValidationRecoveryControls
          onCorrect={onCorrect}
          session={session}
          state={state}
          canCapture={canCapture}
          prepare={feedback.prepare}
        />
      )}
      {state.capture ? (
        <>
          <div className={`scene-capture-count ${SceneCaptureCountStyles}`}>
            <span>{captureStageLabel}</span>
            <strong>
              {done}/{required}
            </strong>
          </div>
          <progress
            aria-label="Saved calibration positions"
            value={done}
            max={required}
          />
          <div className={`scene-hold-status ${SceneHoldStatusStyles}`}>
            <div role="status" aria-live="polite">
              {collectionHint}
            </div>
            <small
              className={`eye-muted ${EyeMutedStyles}`}
              aria-label="Fresh paired samples in this point"
            >
              {state.collection?.samples ?? 0} samples
            </small>
          </div>
          <progress
            aria-label="Current finger hold progress"
            value={state.collection?.progress ?? 0}
            max={1}
          />
          {!marker && (
            <button
              className={`eye-button ${EyeButtonStyles} primary`}
              disabled={!canCapture || !state.collection?.canLock}
              aria-keyshortcuts="Space"
              data-calibration-shortcut
              title={captureButtonTitle}
              onClick={() => {
                feedback.prepare()
                session.lockPoint()
              }}
            >
              <CaptureIcon
                className={captureIconClassName}
                size={16}
                aria-hidden="true"
              />
              {captureLabel}
            </button>
          )}
          <button
            className={`eye-button ${EyeButtonStyles} secondary`}
            onClick={() => session.cancelCapture()}
          >
            <X size={16} aria-hidden="true" /> Cancel
          </button>
        </>
      ) : (
        <button
          className={`eye-button ${EyeButtonStyles} primary`}
          disabled={!canCapture}
          onClick={() => {
            feedback.prepare()
            if (retryHold) {
              session.retryCalibrationPoint()
              return
            }
            session.startCapture("calibration")
            if (onePoint) {
              session.lockPoint()
            }
          }}
        >
          <CalibrationActionIcon size={16} aria-hidden="true" />
          {calibrationActionLabel}
        </button>
      )}
      {state.failedCandidate && !state.capture && (
        <button
          className={`eye-button ${EyeButtonStyles} secondary`}
          onClick={() => session.previewFailedCandidate()}
        >
          Preview failed replacement
        </button>
      )}
      {state.fitFailure?.previewCalibration && !state.capture && (
        <button
          className={`eye-button ${EyeButtonStyles} secondary`}
          onClick={() => session.previewCalibrationCandidate()}
        >
          Preview unverified mapping
        </button>
      )}
      {state.calibration &&
        !state.capture &&
        !state.validation &&
        !onePoint && (
          <button
            className={`eye-button ${EyeButtonStyles} secondary`}
            disabled={!canCapture}
            onClick={() => {
              feedback.prepare()
              session.startCapture("validation")
            }}
          >
            <Crosshair size={16} aria-hidden="true" /> Check again
          </button>
        )}
      {state.calibration && !state.capture && (
        <button
          className={`eye-button ${EyeButtonStyles} primary`}
          onClick={onLive}
        >
          <Play size={16} aria-hidden="true" />{" "}
          {state.validation?.passed || onePoint ? "Live gaze" : "Preview gaze"}
        </button>
      )}
    </>
  )
}
export function SceneLiveControls({
  onCorrect,
  session,
  state,
  onCalibrate,
  canValidate,
  recording = false,
  onMethodChange,
  sceneDimensions,
}: SceneLiveControlsProps) {
  const p = state.measurement?.position
  const [gainEditing, setGainEditing] = useState<SceneOffsetInput | null>(null)
  if (
    state.validation &&
    !state.validation.passed &&
    state.method !== "one-point"
  ) {
    return (
      <>
        <ValidationRecoveryControls
          onCorrect={onCorrect}
          session={session}
          state={state}
          canCapture={canValidate && !recording}
        />
        <button
          className={`eye-button ${EyeButtonStyles} secondary`}
          onClick={onCalibrate}
        >
          <RefreshCw size={16} aria-hidden="true" /> Recalibrate
        </button>
      </>
    )
  }
  const dimensions = sceneDimensions ?? state.calibration?.holds[0]?.pairs[0]
  const currentValidation = state.offset.every(
    (value, index) => value === (state.validation?.offset?.[index] ?? 0)
  )
  let gazeLabel = state.measurement?.preview
    ? "Unverified preview"
    : "Gaze in scene"
  if (state.method === "one-point" && !hasCurrentAccuracyCheck(state)) {
    gazeLabel = "One-point estimate"
  }
  if (state.reusedCalibration && !hasCurrentAccuracyCheck(state)) {
    gazeLabel = "Reused calibration"
  }
  let onePointLabel = "Estimated projection"
  if (state.calibration?.onePoint?.basis === "previous") {
    onePointLabel = "Previous mapping · reanchored"
  }
  return (
    <>
      {onMethodChange && (
        <CalibrationMethodControls
          value={state.method}
          disabled={recording}
          onChange={onMethodChange}
        />
      )}
      <div className={`scene-metrics ${SceneMetricsStyles}`}>
        <div>
          <span>{gazeLabel}</span>
          <strong>
            {(state.measurement?.valid || state.measurement?.preview) && p
              ? `${(p[0] * 100).toFixed(1)}%, ${(p[1] * 100).toFixed(1)}%`
              : "Waiting…"}
          </strong>
        </div>
        <div>
          <span>Mapping</span>
          <strong>
            {state.calibration?.onePoint ? (
              onePointLabel
            ) : (
              <>
                {state.calibration?.model} ·{" "}
                {(
                  (state.calibration?.trainingRms ??
                    state.calibration?.crossValidationRms ??
                    0) * 100
                ).toFixed(1)}
                % fit RMS
              </>
            )}
          </strong>
        </div>
        {state.validation && (
          <div>
            <span
              title={
                currentValidation
                  ? "Measured at five fresh locations with the current offset"
                  : "Measured before this offset change. Check accuracy to measure the corrected mapping."
              }
            >
              {currentValidation
                ? "Fresh accuracy check"
                : "Previous accuracy check"}
            </span>
            <strong>
              {state.validation.pixelRms.toFixed(1)} px RMS ·{" "}
              {state.validation.passed ? "passed" : "recalibrate"}
            </strong>
          </div>
        )}
        {state.validation && (
          <small title="Largest error at a fresh validation location">
            Worst {state.validation.maxPixelError.toFixed(1)} px
          </small>
        )}
      </div>
      {dimensions && (
        <GazeOffsetControls
          onCorrect={onCorrect}
          offset={state.offset}
          width={dimensions.width}
          height={dimensions.height}
          disabled={recording || !!state.capture}
          onChange={(offset) => session.setOffset(offset)}
        />
      )}
      {state.calibration?.onePoint?.basis === "projection" && (
        <details
          className={`scene-projection-controls ${SceneProjectionControlsStyles}`}
        >
          <summary>Adjust estimate</summary>
          <div className={`scene-offset-fields ${SceneOffsetFieldsStyles}`}>
            {(["X", "Y"] as const).map((axis, index) => (
              <label className={`eye-field ${EyeFieldStyles}`} key={axis}>
                {axis} gain
                <input
                  type="number"
                  aria-label={`One-point ${axis} gain`}
                  title="Adjust sensitivity. Negative values reverse the direction. This adjusts an estimate, not measured accuracy."
                  step={0.05}
                  min={-4}
                  max={4}
                  disabled={recording}
                  value={
                    gainEditing?.axis === index
                      ? gainEditing.value
                      : state.calibration!.onePoint!.gain[index]
                  }
                  onFocus={(event) =>
                    setGainEditing({
                      axis: index,
                      value: event.currentTarget.value,
                    })
                  }
                  onInput={(event) => {
                    setGainEditing({
                      axis: index,
                      value: event.currentTarget.value,
                    })
                    const value = event.currentTarget.valueAsNumber
                    if (!Number.isFinite(value)) {
                      return
                    }
                    const gain = [...state.calibration!.onePoint!.gain] as [
                      number,
                      number,
                    ]
                    gain[index] = value
                    session.setOnePointGain(gain)
                  }}
                  onBlur={() => setGainEditing(null)}
                />
              </label>
            ))}
          </div>
        </details>
      )}
      {(state.measurement?.reason || state.measurement?.extrapolated) && (
        <p role="status" className={`eye-muted ${EyeMutedStyles}`}>
          {state.measurement.reason || "Outside calibrated coverage."}
        </p>
      )}
      <button
        className={`eye-button ${EyeButtonStyles} secondary`}
        disabled={!canValidate || recording}
        onClick={() => session.startCapture("validation")}
      >
        <Crosshair size={16} aria-hidden="true" /> Check accuracy
      </button>
      <button
        className={`eye-button ${EyeButtonStyles} secondary`}
        onClick={onCalibrate}
      >
        <RefreshCw size={16} aria-hidden="true" /> Recalibrate
      </button>
    </>
  )
}
