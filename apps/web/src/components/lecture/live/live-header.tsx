"use client";

import type { AccessibilityMode } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from "@sightline/ui/components/dialog";
import { cn } from "@sightline/ui/lib/utils";
import { Crosshair, Ear, Eye, LoaderCircle, Mic, MicOff, ScanEye, ScanFace } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/clay/clay";
import { useElapsed } from "@/components/workspace/active-lecture-card";
import { formatClock } from "@/lib/recordings/timeline";
import { useGaze } from "@/providers/gaze-provider";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { RecordingControl } from "./recording-control";

const ZONE_TEXT = { SCREEN: "on screen", BOARD: "at the board", PERSON: "at a person", AWAY: "away", UNKNOWN: "on screen" } as const;

function ModeSwitch() {
  const lecture = useLiveLecture();
  const [pending, setPending] = useState<AccessibilityMode | null>(null);
  const change = async (mode: AccessibilityMode) => {
    if (mode === lecture.mode || pending) return;
    setPending(mode);
    try {
      await lecture.setMode(mode);
    } finally {
      setPending(null);
    }
  };
  return (
    <div role="radiogroup" aria-label="Lecture mode" className="inline-flex rounded-2xl bg-muted p-1 shadow-[var(--clay-sunken)]">
      {(
        [
          ["DEAF", "Deaf", Eye],
          ["HARD_OF_HEARING", "Hard of hearing", Ear],
        ] as const
      ).map(([value, label, Icon]) => {
        const selected = (pending ?? lecture.mode) === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={selected}
            onClick={() => void change(value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "bg-card text-foreground shadow-[var(--clay-shadow-sm)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {pending === value ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function EndLectureButton() {
  const lecture = useLiveLecture();
  const [open, setOpen] = useState(false);
  const recording = lecture.recorder.state.status === "recording";
  return (
    <AlertDialog open={open} onOpenChange={(next) => !lecture.ending && setOpen(next)}>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        End lecture
      </Button>
      <AlertDialogContent>
        <AlertDialogTitle>End the lecture?</AlertDialogTitle>
        <AlertDialogDescription>
          Captions stop{recording ? ", the recording is saved" : ""} and Sightline starts writing your notes. You can&apos;t restart this lecture.
        </AlertDialogDescription>
        <DialogFooter>
          <AlertDialogClose render={<Button variant="clay-soft" disabled={lecture.ending} />}>Keep going</AlertDialogClose>
          <Button variant="destructive" disabled={lecture.ending} onClick={() => void lecture.end().then(() => setOpen(false)).catch(() => {})}>
            {lecture.ending && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
            {lecture.ending ? (recording ? "Saving the recording…" : "Ending…") : "End lecture"}
          </Button>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Where the student is looking, from the webcam or the eye tracker, with a way to turn the webcam on. */
function GazeStatus() {
  const gaze = useGaze();
  const { attention } = gaze;
  const tracker = gaze.status === "OPEN" && gaze.device?.tracker === "CONNECTED";

  const startWebcam = async () => {
    const failure = await attention.start();
    if (failure) toast.error("Webcam tracking didn't start", { description: failure });
  };

  if (attention.status === "starting") return <StatusPill kind="working" icon={LoaderCircle}>Starting the webcam…</StatusPill>;
  if (attention.status === "learning") return <StatusPill kind="working" icon={ScanFace}>Look at your screen…</StatusPill>;
  if (attention.status === "tracking") {
    return (
      <span className="inline-flex items-center gap-1">
        <StatusPill kind="ready" icon={ScanFace}>Eyes {ZONE_TEXT[gaze.zone]}</StatusPill>
        <Button variant="ghost" size="icon-xs" onClick={attention.recenter} aria-label="Re-center: I'm looking at my screen now" title="Re-center: I'm looking at my screen now">
          <Crosshair />
        </Button>
      </span>
    );
  }
  if (tracker) return <StatusPill kind="ready" icon={ScanEye}>Eyes {ZONE_TEXT[gaze.zone]}</StatusPill>;
  return (
    <Button variant="ghost" size="xs" onClick={() => void startWebcam()}>
      <ScanFace /> Follow my eyes with the webcam
    </Button>
  );
}

export function LiveHeader() {
  const lecture = useLiveLecture();
  const elapsed = useElapsed(lecture.session?.startedAt);
  const socket = lecture.live.status;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[1.75rem] clay px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill kind={socket === "OPEN" ? "live" : "working"}>
            {socket === "OPEN" ? `Live · ${formatClock(elapsed)}` : socket === "RECONNECTING" ? "Reconnecting…" : "Connecting…"}
          </StatusPill>
          <GazeStatus />
          {lecture.live.isReplay ? (
            <StatusPill kind="idle" icon={Mic}>Replayed lecture</StatusPill>
          ) : (
            <StatusPill kind={lecture.mic.mic ? "ready" : "attention"} icon={lecture.mic.mic ? Mic : MicOff}>
              {lecture.mic.mic ? "Mic on" : "Mic off"}
            </StatusPill>
          )}
        </div>
        <h1 className="mt-1.5 truncate text-xl font-extrabold tracking-tight sm:text-2xl">{lecture.session?.title}</h1>
      </div>
      <ModeSwitch />
      <RecordingControl />
      <EndLectureButton />
    </header>
  );
}
