import type { Session, User } from "@/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

export const mockUser: User = {
  id: "usr_demo",
  name: "Demo Student",
  email: "demo@sightline.dev",
};

export const mockSessions: Session[] = [
  {
    id: "ses_kirchhoff",
    title: "EE101 Lecture 7: Kirchhoff's laws",
    subject: "Basic Electrical Engineering",
    mode: "DEAF",
    status: "ENDED",
    contextStatus: "READY",
    slidesStatus: "READY",
    notesStatus: "READY",
    createdAt: now - 2 * DAY,
    startedAt: now - 2 * DAY + 5 * 60_000,
    endedAt: now - 2 * DAY + HOUR,
  },
  {
    id: "ses_thevenin",
    title: "EE101 Lecture 8: Thevenin equivalents",
    subject: "Basic Electrical Engineering",
    mode: "DEAF",
    status: "ENDED",
    contextStatus: "READY",
    slidesStatus: "EMPTY",
    notesStatus: "PROCESSING",
    createdAt: now - 3 * HOUR,
    startedAt: now - 3 * HOUR + 2 * 60_000,
    endedAt: now - 2 * HOUR,
  },
  {
    id: "ses_limits",
    title: "MA102: Limits and continuity",
    subject: "Calculus",
    mode: "HARD_OF_HEARING",
    status: "DRAFT",
    contextStatus: "EMPTY",
    slidesStatus: "EMPTY",
    notesStatus: "EMPTY",
    createdAt: now - 20 * 60_000,
    startedAt: null,
    endedAt: null,
  },
];
