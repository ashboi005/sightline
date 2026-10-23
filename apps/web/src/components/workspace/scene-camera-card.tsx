"use client";
import { Camera, CameraOff, Maximize2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { ScenePreview } from "@/components/setup/scene-preview";
import { hasCurrentAccuracyCheck } from "@/features/scene-tracking/features/scene-eye-tracking/scene-session";
import { useLiveLecture } from "@/providers/live-lecture-provider";
import { useSceneTracking } from "@/providers/scene/context";
import { RailTip } from "./rail-tip";

export function SceneCameraCard({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { scene, state } = useSceneTracking();
  // During a lecture the camera connects from the lecture page; Setup is only needed for eye-tracker calibration.
  const { activeId } = useLiveLecture();
  const connectHref = (activeId ? `/lecture/${activeId}` : "/setup") as Route;
  const live = scene.connection === "live" && !!scene.frame;
  const label = !live
    ? scene.connection === "reconnecting"
      ? "Reconnecting…"
      : "Camera offline"
    : !state.calibration
      ? "Calibration needed"
      : !state.measurement?.position
        ? "Gaze unavailable"
        : hasCurrentAccuracyCheck(state)
          ? "Live gaze"
          : "Gaze estimate";
  if (collapsed)
    return (
      <RailTip label={`Scene camera · ${label}`} show>
        <Link
          href="/setup"
          onClick={onNavigate}
          aria-label={`Open scene camera setup · ${label}`}
          className="relative flex size-12 items-center justify-center overflow-hidden rounded-xl outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring"
        >
          {live ? (
            <div className="absolute inset-0">
              <ScenePreview compact />
            </div>
          ) : (
            <CameraOff className="size-5 text-muted-foreground" />
          )}
        </Link>
      </RailTip>
    );
  return (
    <section
      aria-label="Scene camera with gaze overlay"
      className="w-full rounded-[1.35rem] p-2.5 clay-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 text-xs font-bold">
          <Camera className="size-3.5" /> Scene camera
        </h2>
        <Link
          href="/setup"
          onClick={onNavigate}
          aria-label="Open scene camera setup"
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 className="size-3.5" />
        </Link>
      </div>
      {live ? (
        <ScenePreview compact />
      ) : (
        <Link
          href={connectHref}
          onClick={onNavigate}
          className="flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CameraOff className="size-6" />
          <span className="text-xs font-semibold">{activeId ? "Connect in the lecture" : "Connect in Setup"}</span>
        </Link>
      )}
      <div className="mt-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${live ? "bg-sage-ink" : "bg-muted-foreground"}`}
        />
        {label}
      </div>
    </section>
  );
}
