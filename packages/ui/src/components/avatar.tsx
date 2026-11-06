import { cn } from "@DreamDev/ui/lib/utils";
import * as React from "react";

function Avatar({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar"
      className={cn("relative flex size-9 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border", className)}
      {...props}
    />
  );
}

function AvatarImage({ className, alt = "", ...props }: React.ComponentProps<"img">) {
  return <img data-slot="avatar-image" alt={alt} className={cn("aspect-square size-full object-cover", className)} {...props} />;
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center bg-accent text-xs font-semibold text-accent-foreground uppercase", className)}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
