"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@sightline/ui/lib/utils";
import { XIcon } from "lucide-react";
import * as React from "react";

const backdrop =
  "fixed inset-0 z-50 bg-[#16181c]/40 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";

const centered =
  "fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] bg-card p-6 text-card-foreground shadow-[var(--clay-shadow)] outline-none transition-[opacity,transform] duration-200 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:transition-none";

const sheet =
  "fixed inset-y-3 left-3 z-50 flex w-[min(19rem,calc(100vw-1.5rem))] flex-col rounded-[2rem] bg-background outline-none shadow-[var(--clay-shadow)] transition-transform duration-250 data-[ending-style]:-translate-x-[110%] data-[starting-style]:-translate-x-[110%] motion-reduce:transition-none";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  side,
  showClose = true,
  ...props
}: DialogPrimitive.Popup.Props & { side?: "left"; showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className={backdrop} />
      <DialogPrimitive.Popup data-slot="dialog-content" className={cn(side === "left" ? sheet : centered, className)} {...props}>
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("pr-10 text-xl font-bold tracking-tight", className)} {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("mt-2 text-base leading-relaxed text-muted-foreground", className)} {...props} />;
}

/** A confirmation that needs an explicit answer (no click-outside dismissal). */
const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogClose = AlertDialogPrimitive.Close;

function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className={backdrop} />
      <AlertDialogPrimitive.Popup className={cn(centered, className)} {...props} />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return <AlertDialogPrimitive.Title className={cn("text-xl font-bold tracking-tight", className)} {...props} />;
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return <AlertDialogPrimitive.Description className={cn("mt-2 text-base leading-relaxed text-muted-foreground", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-6 flex flex-wrap justify-end gap-2", className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
};
