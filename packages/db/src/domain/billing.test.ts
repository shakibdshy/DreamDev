import { describe, expect, test } from "bun:test";

import { billForMonth, billedBetween, isBillableMonth, priceAt, quantityAt } from "./billing";
import { at5000, memberFacts, threeShares } from "./test-support";

describe("billing", () => {
  test("bills share quantity × share price from the joining month", () => {
    // The user's own example: 3 shares → ৳15,000 per month
    const member = memberFacts({ allotments: threeShares });
    expect(billForMonth(member, "2026-01")).toBe(15000);
    expect(billedBetween(member, "2026-01", "2026-03")).toBe(45000);
  });

  test("never bills months before the joining month", () => {
    const member = memberFacts({ allotments: threeShares });
    expect(isBillableMonth(member, "2025-12")).toBe(false);
    expect(billForMonth(member, "2025-12")).toBe(0);
  });

  test("a Share Allotment change applies forward from its effective month only", () => {
    // Rahim: 2 shares since January, a 3rd from July
    const member = memberFacts({
      allotments: [
        { effectiveMonth: "2026-01", quantity: 2 },
        { effectiveMonth: "2026-07", quantity: 3 },
      ],
    });
    expect(billForMonth(member, "2026-06")).toBe(10000);
    expect(billForMonth(member, "2026-07")).toBe(15000);
    // Past months never change: Jan–Jun stays ৳10,000 each
    expect(billedBetween(member, "2026-01", "2026-06")).toBe(60000);
    expect(billedBetween(member, "2026-01", "2026-07")).toBe(75000);
  });

  test("resolves the latest allotment regardless of input order", () => {
    const allotments = [
      { effectiveMonth: "2026-07", quantity: 3 },
      { effectiveMonth: "2026-01", quantity: 2 },
    ];
    expect(quantityAt(allotments, "2026-06")).toBe(2);
    expect(quantityAt(allotments, "2026-08")).toBe(3);
  });

  test("an Exit stops billing at the exit month, inclusive", () => {
    const member = memberFacts({ allotments: threeShares, exitMonth: "2026-09" });
    expect(isBillableMonth(member, "2026-09")).toBe(true);
    expect(isBillableMonth(member, "2026-10")).toBe(false);
    expect(billedBetween(member, "2026-08", "2026-10")).toBe(30000);
  });

  test("an Inactive interval pauses billing between its bounds (inclusive)", () => {
    const member = memberFacts({ allotments: threeShares, inactive: [{ from: "2026-03", to: "2026-04" }] });
    expect(isBillableMonth(member, "2026-03")).toBe(false);
    expect(isBillableMonth(member, "2026-04")).toBe(false);
    expect(isBillableMonth(member, "2026-05")).toBe(true);
    expect(billedBetween(member, "2026-02", "2026-05")).toBe(30000);
  });

  test("an open-ended Inactive interval pauses until reactivation", () => {
    const member = memberFacts({ allotments: threeShares, inactive: [{ from: "2026-03" }] });
    expect(billedBetween(member, "2026-02", "2026-05")).toBe(15000);
  });

  test("a Share Price change applies from its effective month", () => {
    const member = memberFacts({
      allotments: [{ effectiveMonth: "2026-01", quantity: 1 }],
      prices: [
        { effectiveMonth: "2026-01", price: 5000 },
        { effectiveMonth: "2027-01", price: 6000 },
      ],
    });
    expect(billForMonth(member, "2026-12")).toBe(5000);
    expect(billForMonth(member, "2027-01")).toBe(6000);
  });

  test("resolves quantity and price at a month", () => {
    const allotments = [
      { effectiveMonth: "2026-01", quantity: 2 },
      { effectiveMonth: "2026-07", quantity: 3 },
    ];
    expect(quantityAt(allotments, "2025-12")).toBe(0);
    expect(quantityAt(allotments, "2026-01")).toBe(2);
    expect(quantityAt(allotments, "2026-08")).toBe(3);
    expect(priceAt(at5000, "2026-01")).toBe(5000);
    expect(priceAt(at5000, "2027-05")).toBe(5000);
  });
});
