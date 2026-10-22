"use client";

import { buttonVariants } from "@sightline/ui/components/button";
import { Skeleton } from "@sightline/ui/components/skeleton";
import { Captions, SearchX } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect } from "react";

import { InlineAlert } from "@/components/clay/clay";
import { EmptyState } from "@/components/clay/empty-state";
import { useSession, useSyncLectureData } from "@/hooks/use-sessions";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { LectureFinished } from "./lecture-finished";
import { LiveWorkspace } from "./live/live-workspace";
import { LecturePrep } from "./prep/lecture-prep";

/** /lecture/[id]: preparation while DRAFT, the workspace while LIVE, the wrap-up once ENDED. */
export function LectureRoute({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const lecture = useLiveLecture();
  const s = session.data;
  useSyncLectureData(s);

  // Opening a live lecture (from a link, another tab or after a reload) follows it, unless another one is running.
  useEffect(() => {
    if (s?.status === "LIVE" && !lecture.activeId) lecture.attach(s.id);
  }, [s?.status, s?.id, lecture]);

  if (session.isPending) return <Skeleton className="mx-auto h-96 max-w-6xl rounded-[2rem]" />;

  if (session.isError) {
    const missing = session.error instanceof ApiRequestError && session.error.status === 404;
    return missing ? (
      <EmptyState
        icon={SearchX}
        title="This lecture doesn't exist"
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: "clay" })}>
            Back to the dashboard
          </Link>
        }
      >
        It may have been deleted, or the link is wrong.
      </EmptyState>
    ) : (
      <InlineAlert>The lecture didn&apos;t load. {errorMessage(session.error)}</InlineAlert>
    );
  }

  if (!s) return null;

  let body: React.ReactNode;
  if (s.status === "DRAFT") body = <LecturePrep session={s} />;
  else if (s.status === "ENDED") body = <LectureFinished session={s} />;
  else if (lecture.activeId && lecture.activeId !== s.id) {
    body = (
      <EmptyState
        icon={Captions}
        tone="marigold"
        title="Another lecture is running"
        action={
          <Link href={`/lecture/${lecture.activeId}` as Route} className={buttonVariants({ variant: "clay" })}>
            Go to the running lecture
          </Link>
        }
      >
        “{lecture.session?.title}” is live on this device. End it before opening another live lecture.
      </EmptyState>
    );
  } else body = <LiveWorkspace />;

  return (
    <>
      <title>{`${s.title} · Sightline`}</title>
      {body}
    </>
  );
}
