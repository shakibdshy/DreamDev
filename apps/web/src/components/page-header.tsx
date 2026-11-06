import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl space-y-2">
        {eyebrow && <p className="text-micro text-primary">{eyebrow}</p>}
        <h1 className="font-display text-3xl leading-[1.05] text-foreground sm:text-[2.5rem]">{title}</h1>
        {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
