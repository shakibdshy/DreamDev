import { CalendarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { todayInDhaka } from "@DreamDev/db/domain/month";
import { Button } from "@DreamDev/ui/components/button";
import { Calendar } from "@DreamDev/ui/components/calendar";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@DreamDev/ui/components/popover";
import { Separator } from "@DreamDev/ui/components/separator";
import { cn } from "@DreamDev/ui/lib/utils";

export type DatePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
  /** Latest selectable day, YYYY-MM-DD — record forms pass todayInDhaka(). */
  max?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/** True when `value` is a well-formed date after today (Asia/Dhaka). */
export function isFutureDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value > todayInDhaka();
}

/** A ledger day is a local calendar date, not a UTC timestamp. */
export function parseCalendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const date = new Date(0);
  // setFullYear avoids the Date constructor's special handling of years 0–99.
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

export function formatCalendarDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "";
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const displayDate = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function DatePicker({
  id,
  value,
  onChange,
  onBlur,
  disabled = false,
  required = false,
  placeholder = "Pick a date",
  clearable = true,
  className,
  max,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = parseCalendarDate(value);
  const today = parseCalendarDate(todayInDhaka())!;
  const maxDate = max ? parseCalendarDate(max) : undefined;
  const startMonth = new Date(1900, 0, 1);
  if (selected && selected < startMonth) startMonth.setFullYear(selected.getFullYear());
  const endMonth = maxDate
    ? new Date(Math.max(maxDate.getFullYear(), selected?.getFullYear() ?? 0), 11, 31)
    : new Date(Math.max(today.getFullYear() + 100, selected?.getFullYear() ?? 0), 11, 31);

  // A portalled calendar must also honor its trigger's disabled fieldset.
  useEffect(() => {
    if (!open) return;
    const closeIfDisabled = () => {
      if (disabled || triggerRef.current?.matches(":disabled")) setOpen(false);
    };
    closeIfDisabled();
    const observer = new MutationObserver(closeIfDisabled);
    let ancestor = triggerRef.current?.parentElement;
    while (ancestor) {
      if (ancestor.tagName === "FIELDSET") {
        observer.observe(ancestor, { attributes: true, attributeFilter: ["disabled"] });
      }
      ancestor = ancestor.parentElement;
    }
    return () => observer.disconnect();
  }, [open, disabled]);

  const changeDate = (date: Date | undefined) => {
    if (disabled || triggerRef.current?.matches(":disabled")) return;
    onChange(date ? formatCalendarDate(date) : "");
    setOpen(false);
    onBlur?.();
  };

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (nextOpen && (disabled || triggerRef.current?.matches(":disabled"))) return;
        setOpen(nextOpen);
        if (!nextOpen) onBlur?.();
      }}
    >
      <PopoverTrigger
        id={id}
        ref={triggerRef}
        disabled={disabled}
        role="combobox"
        aria-required={required || undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onBlur={() => {
          if (!open) onBlur?.();
        }}
        onKeyDown={(event) => {
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !disabled && !triggerRef.current?.matches(":disabled")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        render={
          <Button
            type="button"
            variant="outline"
            className={cn("w-full min-w-0 justify-start", className)}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" aria-hidden />
        <span className={cn("truncate tabular-nums", !selected && "text-muted-foreground")}>
          {selected ? displayDate.format(selected) : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-fit max-w-[min(300px,calc(100vw-1rem))] gap-0 p-0"
        initialFocus={false}
      >
        <PopoverTitle className="sr-only">Choose a date</PopoverTitle>
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected ?? today}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          disabled={maxDate ? [{ after: maxDate }] : undefined}
          autoFocus
          onSelect={changeDate}
        />
        <Separator />
        <div className="flex items-center justify-between gap-2 p-3">
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => changeDate(parseCalendarDate(todayInDhaka()))}>
            Today
          </Button>
          {clearable && !required && (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || !value} onClick={() => changeDate(undefined)}>
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
