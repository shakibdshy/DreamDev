"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@DreamDev/ui/lib/utils";
import { XIcon } from "lucide-react";
import * as React from "react";

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: DialogPrimitive.Popup.Props & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[2px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-black/55"
      />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "relative z-50 my-auto grid w-full max-w-lg grid-cols-1 gap-5 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-float outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]",
            className,
          )}
          {...props}
        >
          {children}
          {showClose && (
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none"
            >
              <XIcon className="size-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("font-display text-2xl leading-tight", className)} {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
