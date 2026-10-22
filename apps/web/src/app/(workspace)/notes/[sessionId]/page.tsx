"use client";

import { use } from "react";

import { NotesLibrary } from "@/components/notes/notes-library";

export default function LectureNotesPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return <NotesLibrary selectedId={sessionId} />;
}
