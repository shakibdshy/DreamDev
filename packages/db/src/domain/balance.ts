/**
 * Current Balance (GLOSSARY.md): Opening Balance plus every money-in entry
 * minus every money-out entry, across the six ledger entry types (ADR-0002).
 * Always derived, never stored.
 */
export type BankEntryType =
  | "contribution"
  | "loan_repayment"
  | "transfer_in"
  | "loan"
  | "expense"
  | "transfer_out";

export interface BankEntry {
  type: BankEntryType;
  amount: number;
}

const MONEY_IN = new Set<BankEntryType>(["contribution", "loan_repayment", "transfer_in"]);

export function currentBalance(openingBalance: number, entries: BankEntry[]): number {
  return entries.reduce(
    (balance, entry) => balance + (MONEY_IN.has(entry.type) ? entry.amount : -entry.amount),
    openingBalance,
  );
}
