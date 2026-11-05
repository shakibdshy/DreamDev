import { describe, expect, test } from "bun:test";

import { dueSummary } from "./due";
import type { MemberBillingFacts } from "./billing";

function facts(overrides: Partial<MemberBillingFacts> = {}): MemberBillingFacts {
  return {
    joiningMonth: "2026-01",
    allotments: [{ effectiveMonth: "2026-01", quantity: 3 }],
    prices: [{ effectiveMonth: "2026-01", price: 5000 }],
    ...overrides,
  };
}

describe("Due (running balance, ADR-0001)", () => {
  test("Due = billed − contributed: 3 shares, one month, pays ৳10,000 → Due ৳5,000", () => {
    // The user's own example from the spec
    const summary = dueSummary(facts(), [{ date: "2026-01-15", amount: 10000, kind: "contribution" }], "2026-01");
    expect(summary.billed).toBe(15000);
    expect(summary.contributed).toBe(10000);
    expect(summary.due).toBe(5000);
  });

  test("overpayment becomes an Advance (negative Due)", () => {
    // Karim's case from the spec: one month billed ৳5,000, pays ৳6,000
    const oneShare = facts({ allotments: [{ effectiveMonth: "2026-01", quantity: 1 }] });
    const summary = dueSummary(oneShare, [{ date: "2026-01-15", amount: 6000, kind: "contribution" }], "2026-01");
    expect(summary.due).toBe(-1000);
    expect(summary.advance).toBe(1000);
  });

  test("carries across months: 1 share, Jan–Mar, pays 5,000 + 5,000 + 6,000", () => {
    const oneShare = facts({ allotments: [{ effectiveMonth: "2026-01", quantity: 1 }] });
    const summary = dueSummary(
      oneShare,
      [
        { date: "2026-01-10", amount: 5000, kind: "contribution" },
        { date: "2026-02-10", amount: 5000, kind: "contribution" },
        { date: "2026-03-10", amount: 6000, kind: "contribution" },
      ],
      "2026-03",
    );
    expect(summary.billed).toBe(15000);
    expect(summary.due).toBe(-1000);
    expect(summary.advance).toBe(1000);
  });

  test("a positive Adjustment (opening due) increases Due; a waiver decreases it", () => {
    const oneShare = facts({ allotments: [{ effectiveMonth: "2026-01", quantity: 1 }] });
    const base = dueSummary(oneShare, [], "2026-02"); // billed 10000
    const openingDue = dueSummary(oneShare, [{ date: "2026-01-05", amount: 3000, kind: "adjustment" }], "2026-02");
    const waived = dueSummary(
      oneShare,
      [
        { date: "2026-01-10", amount: 5000, kind: "contribution" },
        { date: "2026-01-31", amount: -5000, kind: "adjustment" },
      ],
      "2026-02",
    );
    expect(base.due).toBe(10000);
    expect(openingDue.due).toBe(13000);
    // January's bill is waived AND the member paid it — so the payment now covers February
    expect(waived.due).toBe(0);
  });

  test("entries credited after the through-month are ignored", () => {
    const oneShare = facts({ allotments: [{ effectiveMonth: "2026-01", quantity: 1 }] });
    const summary = dueSummary(oneShare, [{ date: "2026-03-02", amount: 5000, kind: "contribution" }], "2026-02");
    expect(summary.contributed).toBe(0);
    expect(summary.due).toBe(10000);
  });
});
