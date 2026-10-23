"use client";

import { VideoOff } from "lucide-react";

import { ScenePreview } from "@/components/setup/scene-preview";
import { CameraTransformControls } from "@/features/scene-tracking/features/eye-tracking/components/camera-transform-controls";
import { SceneSourceControls } from "@/features/scene-tracking/features/scene-eye-tracking/scene-controls";
import { useLiveLecture } from "@/providers/live-lecture-provider";
import { useSceneTracking } from "@/providers/scene/context";

/**
 * Connect and watch the scene camera from the lecture, without Setup's eye-tracker steps. Once it's live the
 * lecture attaches to it, so board snapshots and the recording use this view.
 */
export function SceneCameraPanel() {
  const lecture = useLiveLecture();
  const { scene, tracker } = useSceneTracking();
  const connected = Boolean(scene.source);

  const status =
    scene.connection === "reconnecting"
      ? "Reconnecting…"
      : scene.connection !== "live"
        ? "Connecting…"
        : lecture.scene.video
          ? "Live: snapshots and the recording use this view"
          : "Live";

  return (
    <div className="space-y-3">
      {connected || scene.busy ? (
        <div className="overflow-hidden rounded-[1.2rem]">
          <ScenePreview compact />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[1.2rem] bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          <VideoOff aria-hidden="true" className="size-6" />
          Point a camera at the board, then connect it.
        </div>
      )}
      {connected && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium" role="status">
            {status}
          </p>
          <CameraTransformControls label="Scene camera" value={scene.transform} onChange={scene.camera.setTransform} />
        </div>
      )}
      <SceneSourceControls
        camera={scene.camera}
        state={scene}
        eyeDeviceId={tracker.source?.deviceId}
        onConnected={() => void lecture.scene.start()}
        active
      />
      {lecture.scene.error && <p className="text-sm font-medium text-destructive">{lecture.scene.error}</p>}
    </div>
  );
}
