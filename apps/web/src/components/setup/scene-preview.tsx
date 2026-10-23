"use client";

import { Camera, CircleCheck } from "lucide-react";
import { CameraTransformControls } from "@/features/scene-tracking/features/eye-tracking/components/camera-transform-controls";
import { ScenePreview as TrackingPreview } from "@/features/scene-tracking/features/scene-eye-tracking/scene-preview";
import { hasCurrentAccuracyCheck } from "@/features/scene-tracking/features/scene-eye-tracking/scene-session";
import {
  MAX_FRAME_AGE_MS,
  MAX_HAND_RECOVERY_MS,
} from "@/features/scene-tracking/features/scene-eye-tracking/calibration";
import { useSceneTracking } from "@/providers/scene/context";

export function ScenePreview({
  compact = false,
  correctionRequest = 0,
}: {
  compact?: boolean;
  correctionRequest?: number;
}) {
  const { scene, state, hands, markers } = useSceneTracking();
  const hand =
    hands.previewHand &&
    scene.frame &&
    scene.frame.generation === hands.previewHand.scene.generation &&
    scene.frame.timestamp - hands.previewHand.scene.timestamp <=
      MAX_HAND_RECOVERY_MS
      ? hands.previewHand
      : null;
  const checked = hasCurrentAccuracyCheck(state);
  const marker = state.method === "marker";
  return (
    <div className="scene-feed overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#12171b] text-white">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-bold">
            <Camera className="size-4" /> Scene camera
          </span>
          <CameraTransformControls
            label="Scene camera"
            value={scene.transform}
            disabled={!!state.capture}
            onChange={scene.camera.setTransform}
          />
        </div>
      )}
      <div
        className={
          compact ? "relative aspect-video" : "relative aspect-[4/3] min-h-52"
        }
      >
        <TrackingPreview
          camera={scene.camera}
          frame={scene.frame}
          hand={compact || marker ? null : hand}
          handRecovering={!!hand && hands.hand?.scene.id !== hand.scene.id}
          marker={!compact && marker ? markers.marker : null}
          hideMarkerPattern={marker && !!state.capture}
          method={state.method}
          gaze={state.measurement}
          gazeDisplay={{
            verified: checked,
            errorRadiusPx: checked ? state.validation?.pixelRms : null,
            resetKey: state.calibration,
            maxAgeMs: MAX_FRAME_AGE_MS + Math.abs(state.delayMs),
            offset: state.offset,
            correction:
              !compact && state.calibration && !state.capture
                ? {
                    request: correctionRequest,
                    maxAgeMs: MAX_FRAME_AGE_MS + Math.abs(state.delayMs),
                    onChange: (value) => state.session.setOffset(value),
                  }
                : undefined,
          }}
          trace={compact ? [] : state.trace}
          holds={compact ? [] : (state.collection?.holds ?? [])}
          capturing={!compact && !!state.capture}
          target={
            !compact &&
            state.capture &&
            (state.method !== "one-point" || state.capture === "validation")
              ? (state.collection?.target ?? null)
              : null
          }
          progress={state.collection?.progress ?? 0}
          connection={scene.connection}
        />
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-xs text-white/75">
          <span>
            {scene.connection === "live"
              ? "Live · full frame"
              : scene.connection === "reconnecting"
                ? "Reconnecting camera…"
                : "Camera offline"}
          </span>
          <span className="flex items-center gap-1.5">
            {checked && <CircleCheck className="size-3.5" />}
            {checked
              ? "Accuracy checked"
              : state.calibration
                ? "Accuracy not checked"
                : "Awaiting calibration"}
          </span>
        </div>
      )}
    </div>
  );
}
