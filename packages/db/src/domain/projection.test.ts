import { describe, expect, test } from "bun:test";

import type { MemberBillingFacts } from "./billing";
import { projectMonths } from "./projection";
import type { MemberEntry } from "./due";

function facts(overrides: Partial<MemberBillingFacts> = {}): MemberBillingFacts {
  return {
    joiningMonth: "2026-01",
    allotments: [{ effectiveMonth: "2026-01", quantity: 1 }],
    prices: [{ effectiveMonth: "2026-01", price: 5000 }],
    ...overrides,
  };
}

function contrib(date: string, amount: number): MemberEntry {
  return { date, amount, kind: "contribution" };
}

describe("member×month projection (FIFO, display-only — ADR-0001)", () => {
  test("labels each month paid / partial / due", () => {
    const cells = projectMonths(facts(), [contrib("2026-01-10", 5000), contrib("2026-02-10", 3000)], "2026-01", "2026-03");
    expect(cells.map((c) => c.status)).toEqual(["paid", "partial", "due"]);
    expect(cells[1]?.bill).toBe(5000);
    expect(cells[1]?.applied).toBe(3000);
  });

  test("an overpaid month carries forward: January advance covers February", () => {
    const cells = projectMonths(facts(), [contrib("2026-01-10", 10000)], "2026-01", "2026-02");
    expect(cells.map((c) => c.status)).toEqual(["advance", "paid"]);
  });

  test("carry from before the range seeds the first projected month", () => {
    const cells = projectMonths(facts(), [contrib("2026-01-10", 10000)], "2026-02", "2026-02");
    expect(cells).toHaveLength(1);
    expect(cells[0]?.status).toBe("paid");
  });

  test("a payment in an unbilled month shows as advance, then carries into the next bill", () => {
    const member = facts({ inactive: [{ from: "2026-02", to: "2026-02" }] });
    const cells = projectMonths(member, [contrib("2026-02-10", 2000)], "2026-01", "2026-03");
    // February has no bill so the payment marks it advance — FIFO then applies
    // the ৳2,000 to March's open bill, keeping the walk consistent with the Due
    expect(cells.map((c) => c.status)).toEqual(["due", "advance", "partial"]);
    expect(cells[2]?.applied).toBe(2000);
  });

  test("months outside membership are not billed", () => {
    const member = facts({ exitMonth: "2026-02" });
    const cells = projectMonths(member, [], "2026-01", "2026-03");
    expect(cells.map((c) => c.status)).toEqual(["due", "due", "not-billed"]);
    expect(cells[2]?.bill).toBe(0);
  });

  test("an opening-due Adjustment raises that month's bill; a waiver removes it", () => {
    const entries: MemberEntry[] = [
      contrib("2026-01-10", 5000),
      { date: "2026-01-05", amount: 3000, kind: "adjustment" }, // opening due: January owes 8,000
    ];
    const openingDue = projectMonths(facts(), entries, "2026-01", "2026-01");
    expect(openingDue[0]?.bill).toBe(8000);
    expect(openingDue[0]?.status).toBe("partial");

    const waived = projectMonths(
      facts(),
      [contrib("2026-01-10", 5000), { date: "2026-01-31", amount: -5000, kind: "adjustment" }],
      "2026-01",
      "2026-02",
    );
    // January's bill waived AND paid: the payment carries into February
    expect(waived.map((c) => c.status)).toEqual(["advance", "paid"]);
  });
});
