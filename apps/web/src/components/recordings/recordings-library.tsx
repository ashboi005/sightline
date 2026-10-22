"use client";

import type { Recording, Session } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { Skeleton } from "@sightline/ui/components/skeleton";
import { ChevronLeft, ChevronRight, Clapperboard, FileText, Play } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { InlineAlert, PageHeader, StatusPill, type StatusKind } from "@/components/clay/clay";
import { EmptyState } from "@/components/clay/empty-state";
import { DotGrid, HalfDisc } from "@/components/clay/memphis";
import { useRecordings, useSnapshots } from "@/hooks/use-lecture-data";
import { useSessions } from "@/hooks/use-sessions";
import { assetUrl, errorMessage } from "@/lib/api";
import { formatWhen, lectureMinutes } from "@/lib/format";
import { formatClock } from "@/lib/recordings/timeline";

/** What exists for a lecture's video. A finished lecture doesn't imply a recording. */
export function recordingSummary(recordings: Recording[] | undefined): { kind: StatusKind; label: string; ms: number } {
  const list = recordings ?? [];
  const uploaded = list.flatMap((r) => r.segments.filter((s) => s.status === "UPLOADED"));
  const ms = uploaded.reduce((sum, s) => sum + s.durationMs, 0);
  if (list.some((r) => r.status === "RECORDING")) return { kind: "live", label: "Recording now", ms };
  if (uploaded.length === 0) return list.length ? { kind: "attention", label: "Recording didn't upload", ms } : { kind: "idle", label: "Transcript only", ms };
  const incomplete = list.some((r) => r.status === "FAILED" || r.segments.some((s) => s.status === "PENDING"));
  return incomplete ? { kind: "attention", label: "Partly uploaded", ms } : { kind: "ready", label: `Video · ${formatClock(ms)}`, ms };
}

function Thumbnail({ sessionId, hasVideo }: { sessionId: string; hasVideo: boolean }) {
  const snapshots = useSnapshots(sessionId);
  const first = snapshots.data?.[0];
  return (
    <div className="relative aspect-video overflow-hidden rounded-[1.25rem] clay-lilac">
      {first ? (
        <img src={assetUrl(first.imageUrl)} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <>
          <DotGrid className="absolute top-3 left-3 text-lilac-ink/25" />
          <HalfDisc className="absolute right-4 bottom-0 text-marigold/50" />
        </>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-card/95 shadow-[var(--clay-shadow-sm)]">
          {hasVideo ? <Play aria-hidden="true" className="ml-0.5 size-5 fill-current" /> : <FileText aria-hidden="true" className="size-5" />}
        </span>
      </span>
    </div>
  );
}

function LectureTile({ session }: { session: Session }) {
  const recordings = useRecordings(session.id);
  const summary = recordingSummary(recordings.data);
  const minutes = lectureMinutes(session);
  return (
    <li>
      <Link
        href={`/recordings/${session.id}` as Route}
        className="group block rounded-[1.6rem] clay clay-press p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Thumbnail sessionId={session.id} hasVideo={summary.ms > 0} />
        <div className="px-1.5 pt-3 pb-1">
          {recordings.isPending ? <Skeleton className="h-6 w-28 rounded-full" /> : <StatusPill kind={summary.kind}>{summary.label}</StatusPill>}
          <h3 className="mt-2 leading-snug font-bold text-balance">{session.title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatWhen(session.startedAt ?? session.createdAt)}
            {minutes ? ` · ${minutes} min lecture` : ""}
          </p>
        </div>
      </Link>
    </li>
  );
}

const PAGE_SIZE = 12;

export function RecordingsLibrary() {
  const [page, setPage] = useState(1);
  const sessions = useSessions(page, PAGE_SIZE);
  // Only lectures that ran can have video or a transcript.
  const lectures = (sessions.data?.data ?? []).filter((s) => s.status !== "DRAFT");
  const pagination = sessions.data?.pagination;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Clapperboard}
        tone="lilac"
        title="Recorded lectures"
        description="Watch a lecture again with its captions lined up, or read the transcript when there's no video."
      />

      {sessions.isPending && (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading lectures">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton className="aspect-[4/3] rounded-[1.6rem]" />
            </li>
          ))}
        </ul>
      )}
      {sessions.isError && <InlineAlert>Your lectures didn&apos;t load. {errorMessage(sessions.error)}</InlineAlert>}
      {sessions.isSuccess && lectures.length === 0 && (
        <EmptyState icon={Clapperboard} title="No lectures to watch yet">
          Lectures appear here after they start. Choose a recording source when you set one up to record it.
        </EmptyState>
      )}
      {lectures.length > 0 && (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {lectures.map((s) => (
            <LectureTile key={s.id} session={s} />
          ))}
        </ul>
      )}

      {pagination && pagination.totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-2">
          <Button variant="clay-soft" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft /> Newer
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {page} of {pagination.totalPages}
          </span>
          <Button variant="clay-soft" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            Older <ChevronRight />
          </Button>
        </nav>
      )}
    </div>
  );
}
