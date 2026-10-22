import type { ProcessingStatus, Session } from "@sightline/contracts";

import type { StatusKind } from "@/components/clay/clay";

const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today, 10:02" / "Yesterday, 14:30" / "Tue 21 Oct, 09:00" */
export function formatWhen(ts: number) {
  const day = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const label = same(day, today) ? "Today" : same(day, yesterday) ? "Yesterday" : dateFormat.format(day);
  return `${label}, ${timeFormat.format(day)}`;
}

/** Minutes the lecture ran, when both ends are known. */
export function lectureMinutes(session: Pick<Session, "startedAt" | "endedAt">) {
  if (!session.startedAt || !session.endedAt) return null;
  return Math.max(1, Math.round((session.endedAt - session.startedAt) / 60_000));
}

export const sessionStatus: Record<Session["status"], { label: string; kind: StatusKind }> = {
  DRAFT: { label: "Setting up", kind: "idle" },
  LIVE: { label: "Live now", kind: "live" },
  ENDED: { label: "Finished", kind: "ready" },
};

/** Status of notes/slides/context processing, in the student's words. */
export function processingLabel(status: ProcessingStatus, thing: "Notes" | "Slides" | "Context"): { label: string; kind: StatusKind } {
  switch (status) {
    case "EMPTY":
      return { label: thing === "Notes" ? "No notes yet" : `No ${thing.toLowerCase()}`, kind: "idle" };
    case "PROCESSING":
      return { label: thing === "Notes" ? "Writing notes" : `Processing ${thing.toLowerCase()}`, kind: "working" };
    case "READY":
      return { label: `${thing} ready`, kind: "ready" };
    case "FAILED":
      return { label: `${thing} failed`, kind: "attention" };
  }
}

export const modeLabel = { DEAF: "Deaf mode", HARD_OF_HEARING: "Hard-of-hearing mode" } as const;
