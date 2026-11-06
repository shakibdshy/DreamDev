import { cn } from "@DreamDev/ui/lib/utils";
import * as React from "react";

function Progress({ className, value = 0, ...props }: React.ComponentProps<"div"> & { value?: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      data-slot="progress"
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full rounded-full bg-current transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
