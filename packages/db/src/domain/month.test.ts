import { describe, expect, test } from "bun:test";

import { addMonths, compareMonths, monthOfDate, monthRangeInclusive } from "./month";

describe("month utils (Asia/Dhaka)", () => {
  test("derives the calendar month from a Credit Date", () => {
    expect(monthOfDate("2026-11-05")).toBe("2026-11");
    expect(monthOfDate(new Date("2026-11-05T10:00:00Z"))).toBe("2026-11");
  });

  test("derives the month at the Dhaka clock, not UTC", () => {
    // 2026-01-01 02:00 in Dhaka is still 2025-12-31 in UTC
    expect(monthOfDate(new Date("2025-12-31T20:00:00Z"))).toBe("2026-01");
  });

  test("adds and subtracts months across year boundaries", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-07", 0)).toBe("2026-07");
  });

  test("enumerates an inclusive month range", () => {
    expect(monthRangeInclusive("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthRangeInclusive("2026-03", "2026-03")).toEqual(["2026-03"]);
    expect(monthRangeInclusive("2026-05", "2026-01")).toEqual([]);
  });

  test("orders months", () => {
    expect(compareMonths("2026-02", "2026-03")).toBeLessThan(0);
    expect(compareMonths("2027-01", "2026-12")).toBeGreaterThan(0);
    expect(compareMonths("2026-11", "2026-11")).toBe(0);
  });
});
