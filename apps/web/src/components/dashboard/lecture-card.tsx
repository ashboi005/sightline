import type { Session } from "@sightline/contracts";
import { buttonVariants } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { Ear, Eye } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { StatusPill } from "@/components/clay/clay";
import { formatWhen, lectureMinutes, modeLabel, processingLabel, sessionStatus } from "@/lib/format";

/** The next useful step for a lecture, by its state. */
function actionsFor(s: Session): { label: string; href: string; primary?: boolean }[] {
  if (s.status === "DRAFT") return [{ label: "Continue setup", href: `/lecture/${s.id}`, primary: true }];
  if (s.status === "LIVE") return [{ label: "Return to lecture", href: `/lecture/${s.id}`, primary: true }];
  return [
    { label: "Open notes", href: `/notes/${s.id}`, primary: s.notesStatus === "READY" },
    { label: "Review lecture", href: `/recordings/${s.id}` },
  ];
}

export function LectureCard({ session }: { session: Session }) {
  const status = sessionStatus[session.status];
  const notes = processingLabel(session.notesStatus, "Notes");
  const minutes = lectureMinutes(session);
  const ModeIcon = session.mode === "DEAF" ? Eye : Ear;

  return (
    <li className="flex flex-col rounded-[1.6rem] clay p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill kind={status.kind}>{status.label}</StatusPill>
        {session.status === "ENDED" && <StatusPill kind={notes.kind}>{notes.label}</StatusPill>}
      </div>
      <h3 className="mt-3 text-lg leading-snug font-bold text-balance">{session.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {[session.subject, formatWhen(session.startedAt ?? session.createdAt), minutes && `${minutes} min`].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ModeIcon aria-hidden="true" className="size-4" />
        {modeLabel[session.mode]}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        {actionsFor(session).map((a) => (
          <Link
            key={a.label}
            href={a.href as Route}
            className={cn(buttonVariants({ variant: a.primary ? "clay" : "clay-soft" }), "min-h-10")}
          >
            {a.label}
          </Link>
        ))}
      </div>
    </li>
  );
}
