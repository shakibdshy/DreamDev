import { describe, expect, test } from "bun:test";

import { formatCalendarDate, parseCalendarDate } from "./date-picker";

describe("calendar date values", () => {
  test.each(["", "2026-2-01", "2026-02-1", "2026-02-29", "2026-04-31", "2026-00-10", "2026-13-10", "2026-01-00", "0000-01-01", "2026-01-01T00:00:00Z"])(
    "rejects invalid or non-day value %s",
    (value) => expect(parseCalendarDate(value)).toBeUndefined(),
  );

  test.each(["2024-02-29", "2026-01-01", "2026-03-08", "2026-11-01", "2026-12-31", "0099-01-02"])(
    "round-trips %s without changing the local calendar day",
    (value) => {
      const date = parseCalendarDate(value);
      expect(date).toBeDefined();
      if (!date) throw new Error("Expected a valid date");
      const [year, month, day] = value.split("-").map(Number);
      expect(date.getFullYear()).toBe(year);
      expect(date.getMonth()).toBe(month - 1);
      expect(date.getDate()).toBe(day);
      expect(formatCalendarDate(date)).toBe(value);
    },
  );

  test("formats local date parts rather than the UTC day", () => {
    expect(formatCalendarDate(new Date(2026, 0, 2, 0, 30))).toBe("2026-01-02");
    expect(formatCalendarDate(new Date(2026, 0, 2, 23, 30))).toBe("2026-01-02");
  });

  test("does not serialize invalid dates", () => {
    expect(formatCalendarDate(new Date(Number.NaN))).toBe("");
  });
});
