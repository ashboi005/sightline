"use client";

import { Button, buttonVariants } from "@sightline/ui/components/button";
import { Skeleton } from "@sightline/ui/components/skeleton";
import { cn } from "@sightline/ui/lib/utils";
import { Captions, ChevronLeft, ChevronRight, Hand, Plus, ScanEye } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { ClayCard, IconTile, InlineAlert, SectionTitle, StatusPill } from "@/components/clay/clay";
import { DotGrid, GazeLine, Squiggle } from "@/components/clay/memphis";
import { useElapsed } from "@/components/workspace/active-lecture-card";
import { useSession as useAuthSession } from "@/hooks/use-auth";
import { useSessions } from "@/hooks/use-sessions";
import { errorMessage } from "@/lib/api";
import { formatClock } from "@/lib/recordings/timeline";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { LectureCard } from "./lecture-card";

const PAGE_SIZE = 6;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function LiveNow() {
  const lecture = useLiveLecture();
  const elapsed = useElapsed(lecture.session?.startedAt);
  if (!lecture.activeId) return null;
  return (
    <ClayCard tone="marigold" className="flex flex-wrap items-center gap-4 p-5">
      <IconTile icon={Captions} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold opacity-80">Lecture in progress · {formatClock(elapsed)}</p>
        <p className="mt-0.5 text-xl font-extrabold tracking-tight">{lecture.session?.title ?? "Your lecture"}</p>
      </div>
      <Link href={`/lecture/${lecture.activeId}` as Route} className={cn(buttonVariants({ variant: "clay-soft", size: "lg" }))}>
        Return to lecture
      </Link>
    </ClayCard>
  );
}

function FirstUse() {
  const steps = [
    { icon: ScanEye, tone: "sage" as const, title: "Check your devices", body: "Connect the eye tracker and allow the microphone and camera." },
    { icon: Plus, tone: "marigold" as const, title: "Create a lecture", body: "Give it a title, add the slides or a few lines about the topic." },
    { icon: Captions, tone: "lilac" as const, title: "Read along live", body: "Captions pause when you look at the board, and catch you up after." },
  ];
  return (
    <ClayCard className="p-6 sm:p-8">
      <h2 className="text-xl font-bold tracking-tight">Your first lecture takes about two minutes to set up</h2>
      <ol className="mt-6 grid gap-5 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3.5 sm:flex-col">
            <IconTile icon={s.icon} tone={s.tone} />
            <div>
              <p className="font-bold">
                {i + 1}. {s.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link href="/lecture" className={cn(buttonVariants({ variant: "clay", size: "lg" }), "mt-8")}>
        <Plus /> Create your first lecture
      </Link>
    </ClayCard>
  );
}

export function DashboardView() {
  const [page, setPage] = useState(1);
  const sessions = useSessions(page, PAGE_SIZE);
  const user = useAuthSession().data?.user;
  const firstName = user?.name?.split(" ")[0];
  const pagination = sessions.data?.pagination;
  const empty = sessions.isSuccess && pagination?.totalItems === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] clay px-6 py-8 sm:px-9 sm:py-10">
        <DotGrid className="absolute top-5 right-6 hidden text-lilac-ink/20 sm:block" />
        <Squiggle className="absolute right-24 bottom-6 hidden text-marigold sm:block" />
        <GazeLine className="mb-5" />
        <h1 className="text-[2rem] leading-tight font-extrabold tracking-[-0.03em] sm:text-[2.5rem]">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-2 max-w-xl text-lg text-muted-foreground">
          {pagination?.totalItems
            ? `You have ${pagination.totalItems} lecture${pagination.totalItems === 1 ? "" : "s"} in Sightline. Start the next one when class begins.`
            : "Start a lecture when class begins, and Sightline captions it as you read."}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/lecture" className={buttonVariants({ variant: "clay", size: "lg" })}>
            <Plus /> New lecture
          </Link>
          <Link href="/setup" className={buttonVariants({ variant: "clay-soft", size: "lg" })}>
            <ScanEye /> Check devices
          </Link>
        </div>
      </section>

      <LiveNow />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="recent">
          <SectionTitle
            aside={
              pagination && pagination.totalPages > 1 ? (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="Newer lectures" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft />
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {page} of {pagination.totalPages}
                  </span>
                  <Button variant="ghost" size="icon" aria-label="Older lectures" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight />
                  </Button>
                </div>
              ) : null
            }
          >
            <span id="recent">Recent lectures</span>
          </SectionTitle>

          <div className="mt-4">
            {sessions.isPending && (
              <ul className="grid gap-4 md:grid-cols-2" aria-label="Loading lectures">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <Skeleton className="h-48 rounded-[1.6rem]" />
                  </li>
                ))}
              </ul>
            )}
            {sessions.isError && (
              <InlineAlert action={<Button variant="clay-soft" size="sm" onClick={() => sessions.refetch()}>Try again</Button>}>
                Your lectures didn&apos;t load. {errorMessage(sessions.error)}
              </InlineAlert>
            )}
            {empty && <FirstUse />}
            {sessions.data && !empty && (
              <ul className="grid gap-4 md:grid-cols-2">
                {sessions.data.data.map((s) => (
                  <LectureCard key={s.id} session={s} />
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside aria-label="Quick actions" className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Quick actions</h2>
          <Link href="/setup" className="flex items-center gap-3.5 rounded-[1.5rem] clay-sage clay-press p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <IconTile icon={ScanEye} />
            <span>
              <span className="block font-bold">Device setup</span>
              <span className="block text-sm text-muted-foreground">Eye tracker, mic, camera</span>
            </span>
          </Link>
          <Link href="/sign" className="flex items-center gap-3.5 rounded-[1.5rem] clay-lilac clay-press p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <IconTile icon={Hand} />
            <span>
              <span className="block font-bold">Sign language</span>
              <span className="block text-sm text-muted-foreground">Sign a question, hear it spoken</span>
            </span>
          </Link>
          <p className="px-1 text-sm text-muted-foreground">
            <StatusPill kind="ready" className="mr-1.5">Tip</StatusPill>
            Look up at the board any time. Missed lines stay highlighted until you resume.
          </p>
        </aside>
      </div>
    </div>
  );
}
