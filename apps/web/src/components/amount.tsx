import { formatTaka } from "@DreamDev/db/domain/money";
import { cn } from "@DreamDev/ui/lib/utils";

/** Money with a ledger tone: inflow, outflow, muted zero. */
export function Amount({
  value,
  tone = "auto",
  className,
  showPlus = false,
}: {
  value: number;
  tone?: "auto" | "neutral" | "positive" | "negative";
  className?: string;
  showPlus?: boolean;
}) {
  const resolved = tone === "auto" ? (value > 0 ? "positive" : value < 0 ? "negative" : "neutral") : tone;
  const sign = showPlus && value > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap font-medium",
        resolved === "positive" && "text-success",
        resolved === "negative" && "text-destructive",
        resolved === "neutral" && "text-muted-foreground",
        className,
      )}
    >
      {sign}
      {formatTaka(value)}
    </span>
  );
}
