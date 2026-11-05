/**
 * Calendar months are `YYYY-MM` strings in Asia/Dhaka (GLOSSARY.md).
 */
export const DHAKA_TZ = "Asia/Dhaka";

/** A calendar month in `YYYY-MM` form. */
export type Month = string;

const dhakaYearMonth = new Intl.DateTimeFormat("en-CA", {
  timeZone: DHAKA_TZ,
  year: "numeric",
  month: "2-digit",
});

/**
 * The calendar month a date belongs to, at the Dhaka clock.
 * Date-only strings ("2026-11-05") are taken as-is.
 */
export function monthOfDate(date: Date | string): Month {
  if (typeof date === "string") return date.slice(0, 7);
  const [year, month] = dhakaYearMonth.format(date).split("-");
  return `${year}-${month}`;
}

export function addMonths(month: Month, delta: number): Month {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const total = year * 12 + (mon - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMon = (total % 12) + 1;
  return `${newYear}-${String(newMon).padStart(2, "0")}`;
}

/** Every month from `from` through `through`, both inclusive. Empty if `from` is after `through`. */
export function monthRangeInclusive(from: Month, through: Month): Month[] {
  const months: Month[] = [];
  for (let m = from; compareMonths(m, through) <= 0; m = addMonths(m, 1)) {
    months.push(m);
    if (months.length > 1200) throw new Error(`monthRangeInclusive: range too large (${from}..${through})`);
  }
  return months;
}

export function compareMonths(a: Month, b: Month): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
