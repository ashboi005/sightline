"use client";

import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Camera,
  ScanEye,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import {
  ClayCard,
  InlineAlert,
  PageHeader,
  StatusPill,
} from "@/components/clay/clay";
import { EyePreview } from "@/features/scene-tracking/features/eye-tracking/components/eye-preview";
import { EyeTooltipLayer } from "@/features/scene-tracking/features/eye-tracking/components/eye-tooltip-layer";
import { getTrackerModelLockStatus } from "@/features/scene-tracking/features/eye-tracking/eye-model";
import type {
  FrameSettings,
  Point,
  Rect,
} from "@/features/scene-tracking/features/eye-tracking/eye-tracking.types";
import type { ManualCornerMode } from "@/features/scene-tracking/features/eye-tracking/components/eye-preview.types";
import { SourceControls } from "@/features/scene-tracking/features/eye-tracking/steps/source-controls";
import { RegionControls } from "@/features/scene-tracking/features/eye-tracking/steps/region-controls";
import { ModelControls } from "@/features/scene-tracking/features/eye-tracking/steps/model-controls";
import { ThresholdControls } from "@/features/scene-tracking/features/eye-tracking/threshold-controls";
import { useSceneTracking } from "@/providers/scene/context";
import { useLiveLecture } from "@/providers/live-lecture-provider";
import { SavedCalibrations } from "./saved-calibrations";
import { SceneStep } from "./scene-step";
import { EspSetup } from "./esp-setup";

const STEPS = [
  "Connect hardware",
  "Eye region",
  "Eye model",
  "Scene camera",
  "Calibrate",
  "Accuracy check",
  "Ready",
];
const TITLES = [
  "Connect your eye camera",
  "Frame one eye",
  "Build your eye model",
];
const HELP = [
  "Connect the camera facing your eye. You’ll connect the outward-facing scene camera after the eye model is ready.",
  "Draw a box around one eye. Keep the pupil’s full movement inside it and dark frame edges outside.",
  "Keep your head still. Look left, right, up, down and around the corners until the eye model is ready to lock.",
];

export function SetupFlow() {
  const [segment, setSegment] = useState<"eye" | "esp">("eye");
  const { state } = useSceneTracking();
  const lecture = useLiveLecture();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <nav aria-label="Setup segments" className="grid gap-3 sm:grid-cols-2">
        {(
          [
            [
              "eye",
              Eye,
              "Eye Tracker Setup",
              "Cameras, eye model & gaze calibration",
            ],
            [
              "esp",
              Camera,
              "ESP-CAM Setup",
              "Third camera, person selection & following",
            ],
          ] as const
        ).map(([value, Icon, title, help]) => (
          <button
            key={value}
            type="button"
            aria-pressed={segment === value}
            disabled={!!state.capture || !!lecture.activeId}
            onClick={() => setSegment(value)}
            className={cn(
              "flex items-center gap-4 rounded-3xl p-5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              segment === value
                ? "clay-sage text-sage-ink"
                : "clay-sm hover:bg-muted/50",
            )}
          >
            <Icon className="size-6 shrink-0" />
            <span>
              <span className="block font-bold">{title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {help}
              </span>
            </span>
          </button>
        ))}
      </nav>
      {segment === "eye" ? (
        <EyeTrackerSetup />
      ) : (
        <EspSetup onEyeSetup={() => setSegment("eye")} />
      )}
    </div>
  );
}

function EyeTrackerSetup() {
  const runtime = useSceneTracking();
  const {
    tracker,
    scene,
    state,
    step,
    setStep,
    regionComplete,
    setRegionComplete,
    invalidateEye,
  } = runtime;
  const lecture = useLiveLecture();
  const [corner, setCorner] = useState<Point | null>(null);
  const [cornerMode, setCornerMode] = useState<ManualCornerMode>("create");
  const [notice, setNotice] = useState("");
  const model = getTrackerModelLockStatus(
    tracker.settings,
    tracker.dimensions,
    tracker.frame?.model ?? null,
  );
  const displayedStep =
    state.capture === "validation"
      ? 5
      : state.capture === "calibration"
        ? 4
        : step;
  const allowed = [
    true,
    !!tracker.source,
    !!tracker.source && regionComplete,
    !!tracker.source && tracker.settings.locked,
    runtime.ready,
    !!state.validation,
    !!state.calibration && !state.capture,
  ];
  const update = (next: Partial<FrameSettings>) => {
    invalidateEye();
    tracker.configure(next);
  };
  const chooseRegion = (roi: Rect) => {
    update({ roi });
    setRegionComplete(true);
  };
  const chooseCorner = (point: Point) => {
    if (!corner) setCorner(point);
    else {
      update({ corners: [corner, point] });
      setCorner(null);
      setCornerMode("edit");
    }
  };
  const advance = () => {
    if (step === 1) setRegionComplete(true);
    if (step === 2) tracker.configure({ locked: true }, false);
    setStep(step + 1);
    setNotice("");
  };
  const canContinue =
    step === 0
      ? !!tracker.source && tracker.connection === "live"
      : step === 1
        ? !!tracker.source
        : model.ready;
  return (
    <div className="scene-setup mx-auto max-w-7xl space-y-6">
      <EyeTooltipLayer />
      <PageHeader
        icon={ScanEye}
        tone="sage"
        title="Eye Tracker Setup"
        description="A guided setup for your eye tracker and scene camera. Your calibration stays with your profile."
        actions={
          <StatusPill kind={state.calibration ? "ready" : "idle"}>
            {state.calibration ? "Mapping available" : "Scene camera setup"}
          </StatusPill>
        }
      />
      {lecture.activeId ? (
        <ClayCard className="p-6">
          <h2 className="text-xl font-bold">
            Finish your lecture before changing calibration
          </h2>
          <p className="mt-2 text-muted-foreground">
            Your camera is in use. End the active lecture, then return here to
            configure your headset.
          </p>
        </ClayCard>
      ) : (
        <>
          <SavedCalibrations />
          <nav
            aria-label="Calibration progress"
            className="overflow-x-auto rounded-3xl p-3 clay-sm"
          >
            <ol className="flex min-w-max gap-1 sm:justify-between">
              {STEPS.map((label, index) => (
                <li key={label}>
                  <button
                    type="button"
                    disabled={!allowed[index] || !!state.capture}
                    aria-current={displayedStep === index ? "step" : undefined}
                    onClick={() => setStep(index === 5 ? 4 : index)}
                    className={cn(
                      "flex min-h-14 items-center gap-2 rounded-2xl px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                      displayedStep === index
                        ? "clay-sage text-sage-ink"
                        : !allowed[index]
                          ? "text-muted-foreground/65"
                          : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full",
                        index < displayedStep && allowed[index]
                          ? "bg-sage text-sage-ink"
                          : "bg-muted",
                      )}
                    >
                      {index < displayedStep && allowed[index] ? (
                        <Check className="size-3.5" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {step <= 2 ? (
            <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
              <ClayCard className="eye-setup-preview overflow-hidden p-3 sm:p-4">
                <EyePreview
                  tracker={tracker}
                  selectRegion={step === 1}
                  showModel={step === 2}
                  cornerMode={
                    step === 2 && tracker.settings.format === "classic"
                      ? cornerMode
                      : null
                  }
                  pendingCorner={corner}
                  onRegion={chooseRegion}
                  onCorner={chooseCorner}
                  onCornerModeChange={setCornerMode}
                  onMoveCorners={(corners) => update({ corners })}
                  onMovePendingCorner={setCorner}
                  onEditRegion={() => setStep(1)}
                  onTransformChange={() => {
                    invalidateEye();
                    setStep(1);
                  }}
                />
                {step >= 1 && (
                  <details className="mt-4 px-2">
                    <summary className="cursor-pointer py-2 text-sm font-semibold">
                      Pupil detection settings
                    </summary>
                    <ThresholdControls tracker={tracker} update={update} />
                  </details>
                )}
              </ClayCard>
              <ClayCard className="space-y-5 p-5 sm:p-6">
                <div>
                  <p className="mb-2 text-sm font-bold text-sage-ink">
                    Step {step + 1} of {STEPS.length}
                  </p>
                  <h2 className="text-2xl font-extrabold tracking-tight">
                    {TITLES[step]}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {HELP[step]}
                  </p>
                </div>
                {tracker.error && <InlineAlert>{tracker.error}</InlineAlert>}
                {step === 0 && (
                  <>
                    <SourceControls
                      tracker={tracker}
                      role="scene-eye"
                      excludedDeviceId={scene.source?.deviceId}
                      resetSource={invalidateEye}
                    />
                    <p className="flex items-start gap-2 rounded-2xl bg-sage/60 p-3 text-sm text-sage-ink">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0" /> Camera
                      processing stays in this browser.
                    </p>
                  </>
                )}
                {step === 1 && (
                  <RegionControls
                    tracker={tracker}
                    chooseRegion={chooseRegion}
                  />
                )}
                {step === 2 && (
                  <>
                    <fieldset className="flex gap-2">
                      <legend className="mb-2 text-sm font-semibold">
                        Eye model
                      </legend>
                      {(["spatial", "classic"] as const).map((format) => (
                        <Button
                          key={format}
                          variant={
                            tracker.settings.format === format
                              ? "clay"
                              : "clay-soft"
                          }
                          aria-pressed={tracker.settings.format === format}
                          onClick={() => {
                            update({ format });
                            setRegionComplete(true);
                            setCorner(null);
                          }}
                        >
                          <Eye />
                          {format === "spatial" ? "Automatic" : "Manual"}
                        </Button>
                      ))}
                    </fieldset>
                    <ModelControls
                      tracker={tracker}
                      corner={corner}
                      update={(next) => {
                        update(next);
                        setRegionComplete(true);
                      }}
                      setNotice={setNotice}
                    />
                  </>
                )}
                {notice && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {notice}
                  </p>
                )}
                <div className="flex items-center gap-3 border-t pt-5">
                  {step > 0 && (
                    <Button variant="ghost" onClick={() => setStep(step - 1)}>
                      <ArrowLeft /> Back
                    </Button>
                  )}
                  <Button
                    className="ml-auto"
                    variant="clay"
                    disabled={!canContinue}
                    onClick={advance}
                  >
                    {step === 2 ? "Lock model & continue" : "Continue"}
                    <ArrowRight />
                  </Button>
                </div>
                {step === 0 && !tracker.engineReady && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading the vision engine…
                  </p>
                )}
                {step === 2 && !model.ready && (
                  <p className="text-sm text-muted-foreground">
                    Explore the full range of eye movement to unlock the next
                    step.
                  </p>
                )}
              </ClayCard>
            </div>
          ) : (
            <SceneStep />
          )}
          {step >= 3 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="ghost"
                disabled={!!state.capture}
                onClick={() => setStep(Math.max(0, step - 1))}
              >
                <ArrowLeft /> Previous step
              </Button>
              {state.capture && (
                <Button
                  variant="clay-soft"
                  onClick={() => state.session.cancelCapture()}
                >
                  Cancel capture
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Recalibrate if your headset fit, camera alignment or working
                distance changes.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
