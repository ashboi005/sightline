"use client";

import type { RecordingSource } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@sightline/ui/components/dropdown-menu";
import { Circle, LoaderCircle, Square } from "lucide-react";

import { StatusPill } from "@/components/clay/clay";
import { useElapsed } from "@/components/workspace/active-lecture-card";
import { formatClock } from "@/lib/recordings/timeline";
import { useLiveLecture } from "@/providers/live-lecture-provider";

const SOURCE_LABEL: Record<RecordingSource, string> = { SCENE_CAMERA: "scene camera", WEBCAM: "webcam", SCREEN: "screen" };

/** Start/stop recording, with a persistent "Recording" indicator and an honest result. */
export function RecordingControl() {
  const lecture = useLiveLecture();
  const { recorder, session, activeId } = lecture;
  const state = recorder.state;
  const elapsed = useElapsed(state.status === "recording" ? state.startedAt : null);

  const start = async (source: RecordingSource) => {
    if (!activeId || !session?.startedAt) return;
    const video = source === "SCENE_CAMERA" ? (lecture.scene.video ?? (await lecture.scene.start())) : null;
    await recorder.start({
      sessionId: activeId,
      sessionStartedAt: session.startedAt,
      source,
      sceneStream: (video?.srcObject as MediaStream | null) ?? null,
    });
  };

  if (state.status === "recording") {
    return (
      <div className="flex items-center gap-2">
        <StatusPill kind="live" className="bg-live text-white">
          Recording {SOURCE_LABEL[state.source]} · {formatClock(elapsed)}
        </StatusPill>
        <Button variant="clay-soft" size="sm" onClick={() => void recorder.stop()}>
          <Square /> Stop
        </Button>
      </div>
    );
  }
  if (state.status === "starting" || state.status === "stopping") {
    return (
      <StatusPill kind="working" icon={LoaderCircle}>
        {state.status === "starting" ? "Starting recording…" : "Saving the recording…"}
      </StatusPill>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === "finished" && (
        <StatusPill kind={state.recordingStatus === "READY" && state.uploadFailures === 0 ? "ready" : "attention"}>
          {state.recordingStatus === "READY"
            ? state.uploadFailures
              ? `Saved ${state.segmentsUploaded} part${state.segmentsUploaded === 1 ? "" : "s"}, ${state.uploadFailures} failed`
              : "Recording saved"
            : "Recording failed to upload"}
        </StatusPill>
      )}
      {state.status === "error" && <span className="max-w-xs text-sm text-destructive">{state.message}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="clay-soft" size="sm" />}>
          <Circle className="fill-live text-live" /> Record
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onClick={() => void start("SCENE_CAMERA")}>Record the scene camera</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void start("WEBCAM")}>Record the webcam</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void start("SCREEN")}>Record a screen or window</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
