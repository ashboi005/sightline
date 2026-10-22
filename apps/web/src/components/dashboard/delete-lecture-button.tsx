"use client";

import type { Session } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from "@sightline/ui/components/dialog";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useDeleteSession } from "@/hooks/use-sessions";
import { errorMessage } from "@/lib/api";

/** Deletes a lecture and everything attached to it, after an explicit confirmation. */
export function DeleteLectureButton({
  session,
  onDeleted,
  label = "icon",
}: {
  session: Pick<Session, "id" | "title" | "status">;
  onDeleted?: () => void;
  /** "icon" for cards, "text" for a page's action row. */
  label?: "icon" | "text";
}) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteSession();

  const confirm = () =>
    remove.mutate(session.id, {
      onSuccess: () => {
        setOpen(false);
        toast.success("Lecture deleted");
        onDeleted?.();
      },
    });

  return (
    <AlertDialog open={open} onOpenChange={(next) => !remove.isPending && setOpen(next)}>
      {label === "icon" ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Delete “${session.title}”`} onClick={() => setOpen(true)}>
          <Trash2 />
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Trash2 /> Delete lecture
        </Button>
      )}
      <AlertDialogContent>
        <AlertDialogTitle>Delete “{session.title}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {session.status === "LIVE" ? "The lecture is still live: it stops on every device. " : ""}
          Its captions, slides, board snapshots, recording and notes are deleted too. This can&apos;t be undone.
        </AlertDialogDescription>
        {remove.isError && <p className="mt-3 text-sm font-medium text-destructive">{errorMessage(remove.error)}</p>}
        <DialogFooter>
          <AlertDialogClose render={<Button variant="clay-soft" disabled={remove.isPending} />}>Keep it</AlertDialogClose>
          <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
            {remove.isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
            Delete lecture
          </Button>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
