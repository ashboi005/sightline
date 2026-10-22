"use client";

import type { NotesResponse } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { LoaderCircle } from "lucide-react";

import { InlineAlert } from "@/components/clay/clay";
import { useRegenerateNotes } from "@/hooks/use-lecture-data";
import { errorMessage } from "@/lib/api";

/**
 * What to show when notes aren't simply ready: still being written, never written, or failed.
 * Existing notes stay readable while a regeneration runs or after it fails; this only adds the notice.
 */
export function NotesStatus({ sessionId, notes, ended }: { sessionId: string; notes: NotesResponse; ended: boolean }) {
  const regenerate = useRegenerateNotes(sessionId);

  if (notes.status === "PROCESSING") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-2xl bg-lilac px-4 py-3 text-sm font-semibold text-lilac-ink">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        {notes.notes ? "Rewriting these notes. The current version stays here until the new one is ready." : "Writing the notes from the lecture's captions…"}
      </p>
    );
  }
  if (notes.status === "FAILED") {
    return (
      <InlineAlert
        action={
          ended && (
            <Button variant="clay-soft" size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
              Try again
            </Button>
          )
        }
      >
        {notes.error ?? "The notes couldn't be written."} {notes.notes && "Showing the previous version."}
        {regenerate.isError && ` ${errorMessage(regenerate.error)}`}
      </InlineAlert>
    );
  }
  if (notes.status === "EMPTY") {
    return (
      <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        {ended ? "No notes yet." : "Notes are written when the lecture ends."}
      </p>
    );
  }
  return null;
}
