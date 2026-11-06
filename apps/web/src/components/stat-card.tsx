import { Card } from "@DreamDev/ui/components/card";
import { cn } from "@DreamDev/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

const TONES = {
  default: { icon: "bg-muted text-muted-foreground", value: "" },
  primary: { icon: "bg-primary/10 text-primary", value: "" },
  success: { icon: "bg-success/10 text-success", value: "" },
  warning: { icon: "bg-warning/12 text-warning", value: "" },
  destructive: { icon: "bg-destructive/10 text-destructive", value: "text-destructive" },
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  const colors = TONES[tone];
  return (
    <Card className={cn("gap-4 px-(--card-spacing) py-(--card-spacing)", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", colors.icon)}>
          <Icon className="size-4" />
        </span>
      </div>
      <div>
        <p className={cn("font-display text-3xl leading-none tabular", colors.value)}>{value}</p>
        {hint && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
}
