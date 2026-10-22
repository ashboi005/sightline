import type { Metadata } from "next";

import { NotesLibrary } from "@/components/notes/notes-library";

export const metadata: Metadata = { title: "Notes" };

export default function NotesPage() {
  return <NotesLibrary selectedId={null} />;
}
