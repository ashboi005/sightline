"use client";

import type { Session } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { Input } from "@sightline/ui/components/input";
import { Label } from "@sightline/ui/components/label";
import { Captions, LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClayCard, InlineAlert, PageHeader, SectionTitle, StatusPill } from "@/components/clay/clay";
import { DeleteLectureButton } from "@/components/dashboard/delete-lecture-button";
import { MicrophoneInput } from "@/components/lecture/live/microphone-input";
import { useUpdateSession } from "@/hooks/use-sessions";
import { errorMessage } from "@/lib/api";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { CaptureCard, type CaptureChoice } from "./capture-card";
import { ContextCard } from "./context-card";
import { ModePicker } from "./mode-picker";
import { Readiness } from "./readiness";

function DetailsCard({ session }: { session: Session }) {
  const update = useUpdateSession(session.id);
  const [title, setTitle] = useState(session.title);
  const [subject, setSubject] = useState(session.subject ?? "");
  const save = () => {
    const t = title.trim();
    if (!t) return setTitle(session.title);
    if (t !== session.title || (subject.trim() || null) !== session.subject) update.mutate({ title: t, subject: subject.trim() || null });
  };
  return (
    <ClayCard className="p-6">
      <SectionTitle aside={update.isPending ? <StatusPill kind="working">Saving</StatusPill> : update.isSuccess ? <StatusPill kind="ready">Saved</StatusPill> : null}>
        Lecture details
      </SectionTitle>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prep-title">Title</Label>
          <Input id="prep-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} maxLength={200} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prep-subject">
            Subject <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="prep-subject" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={save} maxLength={200} />
        </div>
      </div>
      {update.isError && <InlineAlert className="mt-4">{errorMessage(update.error)}</InlineAlert>}
    </ClayCard>
  );
}

/** Before the lecture: details, context, mode, recording, readiness, then Start. */
export function LecturePrep({ session }: { session: Session }) {
  const router = useRouter();
  const lecture = useLiveLecture();
  const update = useUpdateSession(session.id);
  const [capture, setCapture] = useState<CaptureChoice>({ sceneCamera: false, record: false, webcam: false });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otherLive = lecture.activeId && lecture.activeId !== session.id;
  const needsMicrophone = lecture.needsMicForCaptions || session.mode === "HARD_OF_HEARING";

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      await lecture.begin(session.id, capture);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Captions}
        title={session.title}
        description="Get the lecture ready. Everything here can be skipped, and captions work without it."
        actions={
          <>
            <StatusPill kind="idle">Setting up</StatusPill>
            <DeleteLectureButton session={session} label="text" onDeleted={() => router.replace("/dashboard")} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <DetailsCard session={session} />
          <ContextCard sessionId={session.id} />
          <ClayCard className="p-6">
            <SectionTitle>Mode</SectionTitle>
            <p className="mt-1.5 text-muted-foreground">You can switch during the lecture.</p>
            <div className="mt-4">
              <ModePicker value={session.mode} onChange={(mode) => update.mutate({ mode })} disabled={update.isPending} />
            </div>
          </ClayCard>
          <CaptureCard value={capture} onChange={setCapture} hardOfHearing={session.mode === "HARD_OF_HEARING"} />
          <ClayCard className="p-5"><MicrophoneInput /></ClayCard>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Readiness mode={session.mode} />
          <ClayCard tone="marigold" className="p-5">
            <p className="font-bold">Start when the teacher starts</p>
            <p className="mt-1 text-sm opacity-80">
              {capture.record ? "Recording the scene camera from the start." : capture.sceneCamera ? "Scene camera on, no recording." : "No recording."}{" "}
              {capture.webcam ? "The webcam follows where you look." : ""}
            </p>
            <Button variant="clay-soft" size="lg" className="mt-4 w-full" onClick={start} disabled={starting || Boolean(otherLive) || (needsMicrophone && !lecture.mic.deviceId)}>
              {starting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Play />}
              {starting ? "Starting the lecture" : "Start lecture"}
            </Button>
            {needsMicrophone && !lecture.mic.deviceId && <p className="mt-2 text-sm">Choose a microphone input before starting.</p>}
          </ClayCard>
          {otherLive && <InlineAlert>Another lecture is still live. End it before starting this one.</InlineAlert>}
          {error && <InlineAlert>{error}</InlineAlert>}
        </div>
      </div>
    </div>
  );
}
