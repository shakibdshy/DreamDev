import { cn } from "@DreamDev/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card px-3 pr-9 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-200 outline-none hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
