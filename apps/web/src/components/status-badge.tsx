import { Badge } from "@DreamDev/ui/components/badge";

const STATUS = {
  active: { variant: "success", label: "Active" },
  inactive: { variant: "warning", label: "Inactive" },
  deactivated: { variant: "warning", label: "Deactivated" },
  exited: { variant: "outline", label: "Exited" },
  paid: { variant: "success", label: "Paid" },
  advance: { variant: "info", label: "Advance" },
  "partial-advance": { variant: "info", label: "Part advance" },
  upcoming: { variant: "outline", label: "Upcoming" },
  partial: { variant: "warning", label: "Partial" },
  due: { variant: "destructive", label: "Due" },
  "not-billed": { variant: "outline", label: "Not billed" },
} as const;

const DOT = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  outline: "bg-muted-foreground/50",
} as const;

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS[status as keyof typeof STATUS] ?? { variant: "outline" as const, label: status.replaceAll("-", " ") };
  return (
    <Badge variant={meta.variant} className={className}>
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[meta.variant as keyof typeof DOT] ?? "bg-muted-foreground/50"}`} />
      <span className="capitalize">{meta.label}</span>
    </Badge>
  );
}
