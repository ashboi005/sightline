"use client";

import { buttonVariants } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { Captions } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { StatusPill } from "@/components/clay/clay";
import { formatClock } from "@/lib/recordings/timeline";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { RailTip } from "./rail-tip";

/** Elapsed time since `since`, ticking every second. */
export function useElapsed(since: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, now - since) : 0;
}

/** The running lecture, visible from every page, with a way back to it. */
export function ActiveLectureCard({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const lecture = useLiveLecture();
  const pathname = usePathname();
  const elapsed = useElapsed(lecture.session?.startedAt);
  const recording = lecture.recorder.state.status === "recording";

  if (!lecture.activeId) return null;
  const href = `/lecture/${lecture.activeId}` as Route;
  const onLecturePage = pathname === href;

  if (collapsed) {
    const label = `${onLecturePage ? "Lecture" : "Return to lecture"}: live ${formatClock(elapsed)}${recording ? ", recording" : ""}`;
    return (
      <RailTip label={label} show>
        <Link
          href={href}
          onClick={onNavigate}
          aria-label={label}
          className="relative inline-flex size-12 items-center justify-center rounded-[1.1rem] clay-marigold clay-press outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Captions aria-hidden="true" className="size-5" />
          <span aria-hidden="true" className={cn("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card", recording ? "bg-live" : "bg-live/80 animate-pulse motion-reduce:animate-none")} />
        </Link>
      </RailTip>
    );
  }

  return (
    <section aria-label="Lecture in progress" className="rounded-[1.5rem] clay-sm p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill kind="live">Live · {formatClock(elapsed)}</StatusPill>
        {recording && (
          <StatusPill kind="live" className="bg-live text-white">
            Recording
          </StatusPill>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-bold">{lecture.session?.title ?? "Your lecture"}</p>
      {!onLecturePage && (
        <Link href={href} onClick={onNavigate} className={cn(buttonVariants({ variant: "clay", size: "sm" }), "mt-3 w-full")}>
          Return to lecture
        </Link>
      )}
    </section>
  );
}
