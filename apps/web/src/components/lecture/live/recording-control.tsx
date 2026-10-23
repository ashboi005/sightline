"use client";

import { Button } from "@sightline/ui/components/button";
import { Circle, LoaderCircle, Square } from "lucide-react";

import { StatusPill } from "@/components/clay/clay";
import { useElapsed } from "@/components/workspace/active-lecture-card";
import { formatClock } from "@/lib/recordings/timeline";
import { useLiveLecture } from "@/providers/live-lecture-provider";

/** Start/stop recording the scene camera (board and teacher), with a persistent indicator and an honest result. */
export function RecordingControl() {
  const lecture = useLiveLecture();
  const { recorder, session, activeId } = lecture;
  const state = recorder.state;
  const elapsed = useElapsed(state.status === "recording" ? state.startedAt : null);

  const start = async () => {
    if (!activeId || !session?.startedAt) return;
    const video = lecture.scene.video ?? (await lecture.scene.start());
    await recorder.start({
      sessionId: activeId,
      sessionStartedAt: session.startedAt,
      source: "SCENE_CAMERA",
      sceneStream: (video?.srcObject as MediaStream | null) ?? null,
    });
  };

  if (state.status === "recording") {
    return (
      <div className="flex items-center gap-2">
        <StatusPill kind="live" className="bg-live text-white">
          Recording · {formatClock(elapsed)}
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
      <Button variant="clay-soft" size="sm" onClick={() => void start()} title="Records the scene camera and room audio">
        <Circle className="fill-live text-live" /> Record
      </Button>
    </div>
  );
}
