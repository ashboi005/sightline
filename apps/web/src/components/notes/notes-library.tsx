"use client";

import type { Session } from "@sightline/contracts";
import { Button, buttonVariants } from "@sightline/ui/components/button";
import { Input } from "@sightline/ui/components/input";
import { Skeleton } from "@sightline/ui/components/skeleton";
import { cn } from "@sightline/ui/lib/utils";
import { ArrowLeft, Clapperboard, Download, NotebookText, RefreshCw, Search } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { InlineAlert, PageHeader, StatusPill } from "@/components/clay/clay";
import { EmptyState } from "@/components/clay/empty-state";
import { useNotes, useRegenerateNotes, useTranscript } from "@/hooks/use-lecture-data";
import { useSessions, useSyncLectureData, useSession } from "@/hooks/use-sessions";
import { api, errorMessage } from "@/lib/api";
import { formatWhen, processingLabel } from "@/lib/format";

import { NotesReader } from "./notes-reader";
import { NotesStatus } from "./notes-status";

/** Downloads the server's Markdown export (sent with the session cookie). */
async function downloadMarkdown(session: Session) {
  const res = await fetch(api.notesExportUrl(session.id), { credentials: "include" });
  if (!res.ok) throw new Error(`The export failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${session.title.replace(/[^\w\- ]+/g, "").trim() || "notes"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function NotesList({ sessions, selectedId }: { sessions: Session[]; selectedId: string | null }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? sessions.filter((s) => `${s.title} ${s.subject ?? ""}`.toLowerCase().includes(q)) : sessions;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search aria-hidden="true" className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search lectures" aria-label="Search lectures" className="pl-10" />
      </div>
      {shown.length === 0 ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">No lectures match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <ul className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {shown.map((s) => {
            const selected = s.id === selectedId;
            const status = processingLabel(s.notesStatus, "Notes");
            return (
              <li key={s.id}>
                <Link
                  href={`/notes/${s.id}` as Route}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "block rounded-[1.25rem] px-4 py-3 outline-none transition-[background,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "clay-sage" : "hover:bg-foreground/5",
                  )}
                >
                  <span className="block leading-snug font-bold">{s.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{formatWhen(s.startedAt ?? s.createdAt)}</span>
                  <StatusPill kind={status.kind} className="mt-2">
                    {status.label}
                  </StatusPill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NotesView({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  useSyncLectureData(session.data);
  const notes = useNotes(sessionId);
  const transcript = useTranscript(sessionId);
  const regenerate = useRegenerateNotes(sessionId);
  const [exportError, setExportError] = useState<string | null>(null);
  const s = session.data;

  if (session.isPending || notes.isPending) return <Skeleton className="h-[32rem] rounded-[1.75rem]" />;
  if (session.isError || !s) return <InlineAlert>These notes didn&apos;t load. {errorMessage(session.error)}</InlineAlert>;
  if (notes.isError) return <InlineAlert>These notes didn&apos;t load. {errorMessage(notes.error)}</InlineAlert>;

  const n = notes.data;
  const ended = s.status === "ENDED";
  const segmentTimes = new Map((transcript.data ?? []).map((seg) => [seg.id, seg.startMs]));

  return (
    <div className="space-y-4">
      <title>{`${s.title}: notes · Sightline`}</title>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/recordings/${s.id}` as Route} className={buttonVariants({ variant: "clay-soft", size: "sm" })}>
          <Clapperboard /> Recording and transcript
        </Link>
        {n.notes && (
          <Button
            variant="clay-soft"
            size="sm"
            onClick={() => downloadMarkdown(s).then(() => setExportError(null), (e) => setExportError(errorMessage(e)))}
          >
            <Download /> Export Markdown
          </Button>
        )}
        {ended && (
          <Button variant="ghost" size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending || n.status === "PROCESSING"}>
            <RefreshCw className={cn((regenerate.isPending || n.status === "PROCESSING") && "animate-spin motion-reduce:animate-none")} />
            Rewrite notes
          </Button>
        )}
      </div>
      {exportError && <InlineAlert>{exportError}</InlineAlert>}
      {regenerate.isError && <InlineAlert>{errorMessage(regenerate.error)}</InlineAlert>}
      <NotesStatus sessionId={s.id} notes={n} ended={ended} />

      {n.notes ? (
        <div className="rounded-[1.75rem] bg-card px-5 py-7 shadow-[var(--clay-shadow-sm)] sm:px-10 sm:py-10">
          <div className="mx-auto max-w-[68ch]">
            <NotesReader notes={n.notes} linker={{ segmentTimes, href: (ms) => `/recordings/${s.id}?t=${Math.round(ms)}` }} />
          </div>
        </div>
      ) : (
        n.status !== "PROCESSING" && (
          <EmptyState icon={NotebookText} tone="sage" title={ended ? "No notes for this lecture" : "Notes come after the lecture"}>
            {ended ? "Rewrite the notes to generate them from the captions." : "They're written from the captions when you press End lecture."}
          </EmptyState>
        )
      )}
    </div>
  );
}

/** /notes and /notes/[id]: a searchable list of lectures beside the selected lecture's notes. */
export function NotesLibrary({ selectedId }: { selectedId: string | null }) {
  const sessions = useSessions(1, 100);
  const lectures = (sessions.data?.data ?? []).filter((s) => s.status !== "DRAFT");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader icon={NotebookText} tone="sage" title="Notes" description="Written from each lecture's captions, with the formulas, definitions and board snapshots in place." />

      {sessions.isError && <InlineAlert>Your lectures didn&apos;t load. {errorMessage(sessions.error)}</InlineAlert>}
      {sessions.isSuccess && lectures.length === 0 ? (
        <EmptyState
          icon={NotebookText}
          tone="sage"
          title="No notes yet"
          action={
            <Link href="/lecture" className={buttonVariants({ variant: "clay" })}>
              Start a lecture
            </Link>
          }
        >
          Notes are written from the captions when a lecture ends.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside aria-label="Lectures" className={cn("lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100svh-3rem)] lg:self-start", selectedId && "hidden lg:flex")}>
            {sessions.isPending ? <Skeleton className="h-80 w-full rounded-[1.5rem]" /> : <NotesList sessions={lectures} selectedId={selectedId} />}
          </aside>
          <section aria-label="Notes" className={cn(!selectedId && "hidden lg:block")}>
            {selectedId ? (
              <>
                <Link href="/notes" className="mb-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden">
                  <ArrowLeft className="size-4" /> All notes
                </Link>
                <NotesView key={selectedId} sessionId={selectedId} />
              </>
            ) : (
              <EmptyState icon={NotebookText} tone="sage" title="Choose a lecture">
                Pick a lecture on the left to read its notes.
              </EmptyState>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
