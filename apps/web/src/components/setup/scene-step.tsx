"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Crosshair } from "lucide-react";
import { Button } from "@sightline/ui/components/button";
import { ClayCard, InlineAlert, StatusPill } from "@/components/clay/clay";
import { CalibrationEyePreview } from "@/features/scene-tracking/features/scene-eye-tracking/calibration-eye-preview";
import { sceneEyeEvidence } from "@/features/scene-tracking/features/scene-eye-tracking/eye-evidence";
import {
  FingerControls,
  SceneLiveControls,
  SceneSourceControls,
} from "@/features/scene-tracking/features/scene-eye-tracking/scene-controls";
import { ScreenCalibrationMarker } from "@/features/scene-tracking/features/scene-eye-tracking/screen-calibration-marker";
import { hasCurrentAccuracyCheck } from "@/features/scene-tracking/features/scene-eye-tracking/scene-session";
import { useSceneTracking } from "@/providers/scene/context";
import { ScenePreview } from "./scene-preview";

export function SceneStep() {
  const { tracker, scene, state, hands, markers, ready, step, setStep } =
    useSceneTracking();
  const [correction, setCorrection] = useState(0);
  const reference = state.method === "marker" ? markers : hands;
  const evidence = sceneEyeEvidence(
    tracker.frame,
    tracker.settings.locked,
    performance.now(),
  );
  const canCapture = ready && evidence.ready && reference.status === "ready";
  const live = step === 6 && !state.capture;
  const capturing = !!state.capture;
  const marker = state.method === "marker" && step >= 4 && !live;
  const onLive = () => setStep(6);
  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
      <div className="space-y-4">
        <ScenePreview correctionRequest={correction} />
        {step >= 4 && !live && (
          <div
            className={
              marker ? "grid gap-4 sm:grid-cols-2" : "mx-auto max-w-md"
            }
          >
            <CalibrationEyePreview tracker={tracker} evidence={evidence} />
            {marker && (
              <div className="flex min-h-64 flex-col rounded-3xl bg-card p-4 shadow-sm">
                <p className="mb-2 text-center text-sm font-bold">
                  Look at the red center
                </p>
                <div className="relative min-h-52 flex-1">
                  <ScreenCalibrationMarker capturing={capturing} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <ClayCard className="space-y-5 p-5 sm:p-6">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-sage-ink">
            <Crosshair className="size-4" />
            {step === 3
              ? "Camera configuration"
              : live
                ? "Live scene gaze"
                : state.capture === "validation"
                  ? "Fresh accuracy check"
                  : "Scene calibration"}
          </div>
          <h2 className="text-xl font-extrabold tracking-tight">
            {step === 3
              ? "Set your view of the room"
              : live
                ? "Your gaze, in the scene"
                : state.capture === "validation"
                  ? "Check five new positions"
                  : "Connect where you look"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {step === 3
              ? "Choose the outward-facing camera. Rotate or mirror the view until it matches the room. Keep both cameras firmly mounted."
              : live
                ? "Look around at your normal working distance. The dot follows your gaze while fresh eye and scene frames are available."
                : "Hand and marker calibration use nine positions, followed by five independent checks. Keep looking at the physical reference at your normal working distance."}
          </p>
        </div>
        {(scene.error || reference.error) && (
          <InlineAlert>{scene.error || reference.error}</InlineAlert>
        )}
        {step === 3 ? (
          <>
            <SceneSourceControls
              camera={scene.camera}
              state={scene}
              eyeDeviceId={tracker.source?.deviceId}
              onConnected={() => {}}
              active
            />
            <Button
              variant="clay"
              className="w-full"
              disabled={!ready}
              onClick={() => setStep(4)}
            >
              Continue to calibration <ArrowRight />
            </Button>
          </>
        ) : live ? (
          <>
            <StatusPill
              kind={hasCurrentAccuracyCheck(state) ? "ready" : "attention"}
            >
              {hasCurrentAccuracyCheck(state)
                ? "Accuracy checked"
                : "Accuracy not checked · estimate"}
            </StatusPill>
            <SceneLiveControls
              onCorrect={() => setCorrection((v) => v + 1)}
              session={state.session}
              state={state}
              sceneDimensions={scene.frame ?? undefined}
              canValidate={canCapture}
              onMethodChange={(method) => {
                state.session.setMethod(method);
                setStep(4);
              }}
              onCalibrate={() => setStep(4)}
            />
            <Link
              href="/lecture"
              className="flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold clay-marigold clay-press"
            >
              <Check className="size-4" /> Done · back to lectures
            </Link>
          </>
        ) : (
          <>
            <FingerControls
              onCorrect={() => setCorrection((v) => v + 1)}
              session={state.session}
              state={state}
              hands={reference}
              canCapture={canCapture}
              retry={reference.retry}
              onLive={onLive}
            />
            {state.notice && (
              <p className="rounded-xl bg-muted/70 p-3 text-sm" role="status">
                {state.notice}
              </p>
            )}
          </>
        )}
        {step >= 4 && (
          <details className="border-t pt-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Camera timing
            </summary>
            <label className="mt-3 block text-sm">
              Scene arrival delay relative to eye · ms
              <input
                className="mt-2 h-11 w-full rounded-xl border bg-card px-3"
                type="number"
                min={-500}
                max={500}
                step={10}
                value={state.delayMs}
                disabled={capturing}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value) && value >= -500 && value <= 500)
                    state.session.setDelay(value);
                }}
              />
            </label>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Positive if the scene arrives later. Changing timing requires a
              new calibration.
            </p>
          </details>
        )}
      </ClayCard>
    </div>
  );
}
