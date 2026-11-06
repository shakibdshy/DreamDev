import { Button } from "@DreamDev/ui/components/button";

export function Pagination({
  page,
  total,
  pageSize,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  total?: number;
  pageSize: number;
  hasNext?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const pageCount = total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        {total === undefined ? `Page ${page}` : `${total.toLocaleString()} record${total === 1 ? "" : "s"} · page ${page} of ${pageCount}`}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={hasNext === false || !hasNext} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
