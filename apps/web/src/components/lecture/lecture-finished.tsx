"use client";

import type { Session } from "@sightline/contracts";
import { Button, buttonVariants } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { Clapperboard, LoaderCircle, NotebookText, PartyPopper } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { ClayCard, IconTile, InlineAlert, PageHeader, StatusPill } from "@/components/clay/clay";
import { HalfDisc, Squiggle } from "@/components/clay/memphis";
import { useNotes, useRecordings, useRegenerateNotes } from "@/hooks/use-lecture-data";
import { errorMessage } from "@/lib/api";
import { formatWhen, lectureMinutes } from "@/lib/format";
import { formatClock } from "@/lib/recordings/timeline";

/** After "End lecture": notes being written, then where to find the recording and the notes. */
export function LectureFinished({ session }: { session: Session }) {
  const notes = useNotes(session.id);
  const recordings = useRecordings(session.id);
  const regenerate = useRegenerateNotes(session.id);
  const status = notes.data?.status;
  const playable = (recordings.data ?? []).filter((r) => r.segments.some((s) => s.status === "UPLOADED"));
  const recordedMs = playable.reduce((sum, r) => sum + r.durationMs, 0);
  const minutes = lectureMinutes(session);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        icon={PartyPopper}
        tone="sage"
        title={session.title}
        description={`Finished ${session.endedAt ? formatWhen(session.endedAt) : ""}${minutes ? ` · ${minutes} min` : ""}`}
        actions={<StatusPill kind="ready">Finished</StatusPill>}
      />

      <ClayCard className="relative overflow-hidden p-6 sm:p-8">
        <HalfDisc className="absolute -right-2 -bottom-1 text-sage" />
        <div className="relative flex items-start gap-4">
          <IconTile icon={NotebookText} tone="sage" size="lg" />
          <div className="min-w-0 flex-1" aria-live="polite">
            {(status === "PROCESSING" || status === "EMPTY" || notes.isPending) && (
              <>
                <h2 className="flex items-center gap-2 text-xl font-bold">
                  <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
                  Writing your notes
                </h2>
                <p className="mt-1 text-muted-foreground">Sightline is turning the captions into sections, definitions and formulas. This takes a minute.</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted shadow-[var(--clay-sunken)]">
                  <div className="h-full w-1/3 animate-[sl-progress_1.6s_ease-in-out_infinite] rounded-full bg-marigold motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
                </div>
              </>
            )}
            {status === "READY" && (
              <>
                <h2 className="text-xl font-bold">Your notes are ready</h2>
                <p className="mt-1 text-muted-foreground">{notes.data?.notes?.summary}</p>
                <Link href={`/notes/${session.id}` as Route} className={cn(buttonVariants({ variant: "clay", size: "lg" }), "mt-5")}>
                  Open notes
                </Link>
              </>
            )}
            {status === "FAILED" && (
              <>
                <h2 className="text-xl font-bold">The notes couldn&apos;t be written</h2>
                <InlineAlert className="mt-3">{notes.data?.error ?? "Something went wrong while writing the notes."}</InlineAlert>
                <Button variant="clay" className="mt-4" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
                  Try again
                </Button>
                {regenerate.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(regenerate.error)}</p>}
              </>
            )}
          </div>
        </div>
      </ClayCard>

      <ClayCard className="flex flex-wrap items-center gap-4 p-6">
        <IconTile icon={Clapperboard} tone="lilac" size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{playable.length ? "Recording and transcript" : "Transcript"}</h2>
          <p className="text-muted-foreground">
            {recordings.isPending
              ? "Checking for a recording…"
              : playable.length
                ? `${formatClock(recordedMs)} of video, lined up with the captions.`
                : "This lecture wasn't recorded, but the full transcript is there to read and search."}
          </p>
        </div>
        <Link href={`/recordings/${session.id}` as Route} className={buttonVariants({ variant: "clay-soft", size: "lg" })}>
          {playable.length ? "Watch the recording" : "Read the transcript"}
        </Link>
      </ClayCard>
      <Squiggle className="mx-auto block text-lilac-ink/30" />
    </div>
  );
}
