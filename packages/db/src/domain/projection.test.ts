import { describe, expect, test } from "bun:test";

import type { MemberEntry } from "./due";
import { projectMonths } from "./projection";
import { memberFacts } from "./test-support";

function contrib(date: string, amount: number): MemberEntry {
  return { date, amount, kind: "contribution" };
}

describe("member×month projection (FIFO, display-only — ADR-0001)", () => {
  test("labels each month paid / partial / due", () => {
    const cells = projectMonths(memberFacts(), [contrib("2026-01-10", 5000), contrib("2026-02-10", 3000)], "2026-01", "2026-03");
    expect(cells.map((c) => c.status)).toEqual(["paid", "partial", "due"]);
    expect(cells[1]?.bill).toBe(5000);
    expect(cells[1]?.applied).toBe(3000);
  });

  test("an overpayment covers the following month's bill within the range", () => {
    const cells = projectMonths(memberFacts(), [contrib("2026-01-10", 10000)], "2026-01", "2026-02");
    expect(cells.map((c) => c.status)).toEqual(["paid", "paid"]);
  });

  test("money beyond every bill through the range is the Advance", () => {
    const cells = projectMonths(memberFacts(), [contrib("2026-01-10", 20000)], "2026-01", "2026-03");
    expect(cells.map((c) => c.status)).toEqual(["paid", "paid", "advance"]);
  });

  test("a late payment retires the oldest unpaid bills first, not its own month", () => {
    // The ADR-0001 FIFO walk: a member who pays in November after ten quiet
    // months sees January and February settle — November is not "advance".
    const member = memberFacts({ allotments: [{ effectiveMonth: "2026-01", quantity: 3 }] });
    const cells = projectMonths(member, [contrib("2026-11-06", 30000)], "2026-01", "2026-11");
    const statuses = cells.map((c) => c.status);
    expect(statuses.slice(0, 2)).toEqual(["paid", "paid"]);
    expect(statuses.slice(2)).toEqual(Array(9).fill("due"));
    expect(cells[0]?.applied).toBe(15000);
    expect(cells[1]?.applied).toBe(15000);
  });

  test("carry from before the range seeds the first projected month", () => {
    const cells = projectMonths(memberFacts(), [contrib("2026-01-10", 10000)], "2026-02", "2026-02");
    expect(cells).toHaveLength(1);
    expect(cells[0]?.status).toBe("paid");
  });

  test("a Contribution in an unbilled month pays the oldest open bill first", () => {
    const member = memberFacts({ inactive: [{ from: "2026-02", to: "2026-02" }] });
    const cells = projectMonths(member, [contrib("2026-02-10", 2000)], "2026-01", "2026-03");
    // February has no bill; FIFO applies the ৳2,000 to January's older open
    // bill, keeping the walk consistent with the Due
    expect(cells.map((c) => c.status)).toEqual(["partial", "advance", "due"]);
    expect(cells[0]?.applied).toBe(2000);
  });

  test("months outside membership are not billed", () => {
    const member = memberFacts({ exitMonth: "2026-02" });
    const cells = projectMonths(member, [], "2026-01", "2026-03");
    expect(cells.map((c) => c.status)).toEqual(["due", "due", "not-billed"]);
    expect(cells[2]?.bill).toBe(0);
  });

  test("a pre-joining opening-due Adjustment surfaces in the first projected month", () => {
    // Otherwise the grid would hide a debt the Due still counts
    const entries: MemberEntry[] = [{ date: "2025-12-15", amount: 3000, kind: "adjustment" }];
    const cells = projectMonths(memberFacts(), entries, "2026-01", "2026-01");
    expect(cells[0]?.bill).toBe(8000);
    expect(cells[0]?.status).toBe("due");
  });

  test("unpaid bills from before the range surface in the first projected month", () => {
    // Joined 2025-11 with shares from day one, nothing paid; the 2026 grid must not look clean
    const member = memberFacts({
      joiningMonth: "2025-11",
      allotments: [{ effectiveMonth: "2025-11", quantity: 1 }],
      prices: [{ effectiveMonth: "2025-11", price: 5000 }],
    });
    const cells = projectMonths(member, [], "2026-01", "2026-01");
    expect(cells[0]?.bill).toBe(15000); // Nov + Dec + Jan
    expect(cells[0]?.status).toBe("due");
  });

  test("an opening-due Adjustment raises that month's bill; a waiver removes it", () => {
    const entries: MemberEntry[] = [
      contrib("2026-01-10", 5000),
      { date: "2026-01-05", amount: 3000, kind: "adjustment" }, // opening due: January owes 8,000
    ];
    const openingDue = projectMonths(memberFacts(), entries, "2026-01", "2026-01");
    expect(openingDue[0]?.bill).toBe(8000);
    expect(openingDue[0]?.status).toBe("partial");

    const waived = projectMonths(
      memberFacts(),
      [contrib("2026-01-10", 5000), { date: "2026-01-31", amount: -5000, kind: "adjustment" }],
      "2026-01",
      "2026-02",
    );
    // January's bill waived AND paid: the Contribution carries into February
    expect(waived.map((c) => c.status)).toEqual(["advance", "paid"]);
  });
});
