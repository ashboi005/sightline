"use client";

import type { GlossaryTerm } from "@sightline/contracts";
import { buttonVariants } from "@sightline/ui/components/button";
import { Skeleton } from "@sightline/ui/components/skeleton";
import { cn } from "@sightline/ui/lib/utils";
import { Clapperboard, NotebookText, SearchX, VideoOff } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { ClayCard, IconTile, InlineAlert, PageHeader, SectionTitle, StatusPill } from "@/components/clay/clay";
import { EmptyState } from "@/components/clay/empty-state";
import { NotesReader } from "@/components/notes/notes-reader";
import { NotesStatus } from "@/components/notes/notes-status";
import { useLectureContext, useNotes, useRecordings, useTranscript } from "@/hooks/use-lecture-data";
import { useSession, useSyncLectureData } from "@/hooks/use-sessions";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { formatWhen, lectureMinutes } from "@/lib/format";
import { playableSegments } from "@/lib/recordings/timeline";

import { RecordingPlayer, type SeekRequest } from "./recording-player";
import { recordingSummary } from "./recordings-library";
import { TranscriptList } from "./transcript-list";

/** /recordings/[id]: video on top, transcript below, notes on the right. `?t=<ms>` opens at a lecture moment. */
export function RecordingDetail({ sessionId }: { sessionId: string }) {
  const params = useSearchParams();
  const session = useSession(sessionId);
  useSyncLectureData(session.data);
  const recordings = useRecordings(sessionId);
  const transcript = useTranscript(sessionId);
  const notes = useNotes(sessionId);
  const context = useLectureContext(sessionId);
  const glossary = new Map<string, GlossaryTerm>((context.data?.glossary ?? []).map((t) => [t.id, t]));

  const [lectureMs, setLectureMs] = useState<number | null>(null);
  const [seek, setSeek] = useState<SeekRequest | null>(null);

  // Prefer the recording with the most uploaded video.
  const recording = [...(recordings.data ?? [])].sort(
    (a, b) => playableSegments(b.segments).length - playableSegments(a.segments).length,
  )[0];
  const segments = recording ? playableSegments(recording.segments) : [];
  const summary = recordingSummary(recordings.data);

  // A link with ?t= (from the notes) starts at that moment, once the recording list has loaded.
  const openAtLinkedMoment = useEffectEvent(() => {
    const t = Number(params.get("t"));
    if (!params.has("t") || !Number.isFinite(t)) return;
    setLectureMs(t);
    if (segments.length) setSeek({ ms: t, nonce: Date.now() });
  });
  useEffect(() => {
    if (recordings.isSuccess) openAtLinkedMoment();
  }, [recordings.isSuccess]);

  if (session.isPending) return <Skeleton className="mx-auto h-96 max-w-7xl rounded-[2rem]" />;
  if (session.isError) {
    const missing = session.error instanceof ApiRequestError && session.error.status === 404;
    return missing ? (
      <EmptyState icon={SearchX} title="This lecture doesn't exist" action={<Link href="/recordings" className={buttonVariants({ variant: "clay" })}>All recorded lectures</Link>}>
        It may have been deleted.
      </EmptyState>
    ) : (
      <InlineAlert>The lecture didn&apos;t load. {errorMessage(session.error)}</InlineAlert>
    );
  }

  const s = session.data;
  const minutes = lectureMinutes(s);
  const incompleteParts = recording ? recording.segments.filter((x) => x.status !== "UPLOADED").length : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <title>{`${s.title}: recording · Sightline`}</title>
      <PageHeader
        icon={Clapperboard}
        tone="lilac"
        title={s.title}
        description={`${formatWhen(s.startedAt ?? s.createdAt)}${minutes ? ` · ${minutes} min` : ""}${s.subject ? ` · ${s.subject}` : ""}`}
        actions={
          <>
            <StatusPill kind={summary.kind}>{summary.label}</StatusPill>
            <Link href={`/notes/${s.id}` as Route} className={buttonVariants({ variant: "clay-soft" })}>
              <NotebookText /> Full notes
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0 space-y-6">
          <ClayCard className="p-4 sm:p-5">
            {recordings.isPending ? (
              <Skeleton className="aspect-video rounded-[1.4rem]" />
            ) : segments.length ? (
              <>
                <RecordingPlayer segments={segments} seek={seek} onTime={setLectureMs} onExpired={() => recordings.refetch()} />
                {recording && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Recorded from the {{ SCENE_CAMERA: "scene camera", WEBCAM: "webcam", SCREEN: "screen" }[recording.source]}
                  </p>
                )}
                {incompleteParts > 0 && (
                  <p className="mt-2 text-sm text-destructive">
                    {incompleteParts} part{incompleteParts === 1 ? "" : "s"} of this recording didn&apos;t finish uploading and can&apos;t be played.
                  </p>
                )}
              </>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-[1.4rem] clay-sunken p-6 text-center">
                <IconTile icon={VideoOff} tone="lilac" size="lg" />
                <p className="text-lg font-bold">{summary.label === "Recording now" ? "This lecture is still recording" : recordings.data?.length ? "The recording didn't upload" : "This lecture wasn't recorded"}</p>
                <p className="max-w-sm text-muted-foreground">The transcript below has everything that was said.</p>
              </div>
            )}
          </ClayCard>

          <ClayCard className="p-5">
            <SectionTitle>Transcript</SectionTitle>
            <div className="mt-4 rounded-2xl bg-card">
              {transcript.isPending && <Skeleton className="h-64 rounded-2xl" />}
              {transcript.isError && <InlineAlert>The transcript didn&apos;t load. {errorMessage(transcript.error)}</InlineAlert>}
              {transcript.data && transcript.data.length === 0 && <p className="py-8 text-center text-muted-foreground">No captions were saved for this lecture.</p>}
              {transcript.data && transcript.data.length > 0 && (
                <TranscriptList
                  segments={transcript.data}
                  glossary={glossary}
                  lectureMs={lectureMs}
                  canSeek={segments.length > 0}
                  onSeek={(ms) => {
                    // With video, play from there (the player reports the time back); without, mark the line.
                    if (segments.length) setSeek({ ms, nonce: Date.now() });
                    else setLectureMs(ms);
                  }}
                />
              )}
            </div>
          </ClayCard>
        </div>

        <aside aria-label="Summary and notes" className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto">
          <ClayCard className="p-5">
            {notes.data && <NotesStatus sessionId={s.id} notes={notes.data} ended={s.status === "ENDED"} />}
            {notes.isPending && <Skeleton className="h-48 rounded-2xl" />}
            {notes.data?.notes && (
              <div className={cn(notes.data.status !== "READY" && "mt-4")}>
                <NotesReader notes={notes.data.notes} compact headingLevel={2} />
              </div>
            )}
            <Link href={`/notes/${s.id}` as Route} className={cn(buttonVariants({ variant: "clay", size: "sm" }), "mt-5 w-full")}>
              Open the full notes
            </Link>
          </ClayCard>
        </aside>
      </div>
    </div>
  );
}
