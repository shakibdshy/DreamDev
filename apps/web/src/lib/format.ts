const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function asDate(value: string | Date) {
  if (value instanceof Date) return value;
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
}

export function formatDay(value: string | Date) {
  return DAY.format(asDate(value));
}

export function formatDayShort(value: string | Date) {
  return DAY_SHORT.format(asDate(value));
}

export function formatDateTime(value: string | Date) {
  return DATE_TIME.format(asDate(value));
}

/** "2026-11" → "Nov 2026" */
export function formatMonth(month: string) {
  return MONTH.format(new Date(`${month}-01T00:00:00Z`));
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function todayLong() {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}
