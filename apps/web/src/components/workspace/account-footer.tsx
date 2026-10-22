"use client";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from "@sightline/ui/components/dialog";
import { Button } from "@sightline/ui/components/button";
import { cn } from "@sightline/ui/lib/utils";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import { useSession, useSignOut } from "@/hooks/use-auth";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { RailTip } from "./rail-tip";

/** Account and theme: quiet, at the bottom of the sidebar. */
export function AccountFooter({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { data } = useSession();
  const signOut = useSignOut();
  const lecture = useLiveLecture();
  const [confirming, setConfirming] = useState(false);
  const user = data?.user;

  const doSignOut = () => signOut.mutate(undefined, { onSuccess: () => router.push("/") });

  return (
    <div className={cn("flex items-center gap-2.5 rounded-[1.25rem] px-1.5 py-1", collapsed && "flex-col")}>
      <RailTip label={`${user?.name ?? ""} · ${user?.email ?? ""}`} show={collapsed}>
        <span
          role="img"
          aria-label={collapsed ? `Signed in as ${user?.name}` : undefined}
          aria-hidden={collapsed ? undefined : true}
          tabIndex={collapsed ? 0 : undefined}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl clay-lilac text-sm font-extrabold text-lilac-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {user?.name?.charAt(0).toUpperCase() ?? "?"}
        </span>
      </RailTip>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
      )}
      <ModeToggle />
      <RailTip label="Sign out" show={collapsed}>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => (lecture.activeId ? setConfirming(true) : doSignOut())}>
          <LogOut />
        </Button>
      </RailTip>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Sign out during a lecture?</AlertDialogTitle>
          <AlertDialogDescription>
            Captions, recording and voice focus stop on this device. The lecture stays live until you end it, so end it
            first if you&apos;re finished.
          </AlertDialogDescription>
          <DialogFooter>
            <AlertDialogClose render={<Button variant="clay-soft" />}>Stay signed in</AlertDialogClose>
            <Button variant="destructive" onClick={doSignOut}>
              Sign out anyway
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
