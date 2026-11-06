import { ArrowDownLeftIcon, ArrowLeftRightIcon, ArrowUpRightIcon, ReceiptIcon, RotateCcwIcon, ScaleIcon, type LucideIcon } from "lucide-react";

export const TYPE_LABELS: Record<string, string> = {
  contribution: "Contribution",
  loan: "Loan",
  loan_repayment: "Repayment",
  expense: "Expense",
  transfer: "Transfer",
  adjustment: "Adjustment",
};

const META: Record<string, { icon: LucideIcon; className: string }> = {
  contribution: { icon: ArrowDownLeftIcon, className: "bg-success/10 text-success" },
  loan: { icon: ArrowUpRightIcon, className: "bg-destructive/10 text-destructive" },
  loan_repayment: { icon: RotateCcwIcon, className: "bg-success/10 text-success" },
  expense: { icon: ReceiptIcon, className: "bg-warning/12 text-warning" },
  transfer: { icon: ArrowLeftRightIcon, className: "bg-info/10 text-info" },
  adjustment: { icon: ScaleIcon, className: "bg-chart-5/12 text-chart-5" },
};

export function TransactionIcon({ type, className }: { type: string; className?: string }) {
  const meta = META[type] ?? { icon: ReceiptIcon, className: "bg-muted text-muted-foreground" };
  const Icon = meta.icon;
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${meta.className} ${className ?? ""}`}>
      <Icon className="size-4" />
    </span>
  );
}
