import { describe, expect, test } from "bun:test";

import { currentBalance, type BankEntry } from "./balance";

describe("Current Balance (computed, never stored — GLOSSARY.md)", () => {
  test("equals the Opening Balance with no entries", () => {
    expect(currentBalance(25000, [])).toBe(25000);
  });

  test("adds money in and subtracts money out across all six entry types", () => {
    const entries: BankEntry[] = [
      { type: "contribution", amount: 5000 },
      { type: "loan", amount: 20000 },
      { type: "loan_repayment", amount: 5000 },
      { type: "expense", amount: 500 },
      { type: "transfer_out", amount: 3000 },
      { type: "transfer_in", amount: 3000 },
    ];
    // 10,000 + 5,000 − 20,000 + 5,000 − 500 − 3,000 + 3,000 = −500
    expect(currentBalance(10000, entries)).toBe(-500);
  });

  test("each money-in type raises the balance", () => {
    for (const type of ["contribution", "loan_repayment", "transfer_in"] as const) {
      expect(currentBalance(0, [{ type, amount: 1000 }])).toBe(1000);
    }
  });

  test("each money-out type lowers the balance", () => {
    for (const type of ["loan", "expense", "transfer_out"] as const) {
      expect(currentBalance(0, [{ type, amount: 1000 }])).toBe(-1000);
    }
  });

  test("a Transfer nets to zero across the fund's own accounts", () => {
    const out = currentBalance(10000, [{ type: "transfer_out", amount: 3000 }]);
    const into = currentBalance(0, [{ type: "transfer_in", amount: 3000 }]);
    expect(out).toBe(7000);
    expect(into).toBe(3000);
  });
});
