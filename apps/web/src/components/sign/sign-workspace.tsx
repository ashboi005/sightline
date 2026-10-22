"use client";

import { buttonVariants } from "@sightline/ui/components/button";
import { Label } from "@sightline/ui/components/label";
import { Hand } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ClayCard, PageHeader } from "@/components/clay/clay";
import { EmptyState } from "@/components/clay/empty-state";
import { useSessions } from "@/hooks/use-sessions";
import { formatWhen, sessionStatus } from "@/lib/format";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { SignPanel } from "./sign-panel";

/**
 * Sign → text → speech, full size. Sign messages are saved with a lecture, so this uses the running lecture or one
 * the student picks (kept in `?session=` so a refresh keeps it).
 */
export function SignWorkspace() {
  const lecture = useLiveLecture();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sessions = useSessions(1, 50);
  const lectures = sessions.data?.data ?? [];
  const chosen = params.get("session") ?? lecture.activeId ?? lectures.find((s) => s.status !== "DRAFT")?.id ?? lectures[0]?.id ?? null;

  const choose = (id: string) => router.replace(`${pathname}?session=${encodeURIComponent(id)}` as Route, { scroll: false });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Hand}
        tone="lilac"
        title="Sign language"
        description="Sign a question at your webcam. Sightline writes it as a sentence and can say it out loud for the room."
      />

      {sessions.isSuccess && lectures.length === 0 ? (
        <EmptyState
          icon={Hand}
          title="Sign messages are saved with a lecture"
          action={
            <Link href="/lecture" className={buttonVariants({ variant: "clay" })}>
              Create a lecture
            </Link>
          }
        >
          Create a lecture first. You can sign during it, or open it here afterwards.
        </EmptyState>
      ) : (
        <>
          <ClayCard className="flex flex-wrap items-end gap-4 p-4 sm:p-5">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="sign-lecture">Save the conversation with</Label>
              <select
                id="sign-lecture"
                value={chosen ?? ""}
                onChange={(e) => choose(e.target.value)}
                className="h-11 w-full max-w-xl rounded-2xl border border-input bg-card px-3.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {lectures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {sessionStatus[s.status].label} · {formatWhen(s.startedAt ?? s.createdAt)}
                  </option>
                ))}
              </select>
            </div>
            {lecture.activeId && chosen !== lecture.activeId && (
              <button type="button" onClick={() => choose(lecture.activeId!)} className="text-sm font-semibold underline decoration-marigold decoration-2 underline-offset-4">
                Use the live lecture
              </button>
            )}
          </ClayCard>

          <ClayCard className="p-4 sm:p-6">
            <SignPanel key={chosen} sessionId={chosen} variant="page" />
          </ClayCard>
        </>
      )}
    </div>
  );
}
