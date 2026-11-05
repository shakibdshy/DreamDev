import { billedBetween, type MemberBillingFacts } from "./billing";
import { compareMonths, monthOfDate, type Month } from "./month";

/**
 * A Member's money event: a Contribution (positive amount paid) or an
 * Adjustment (signed amount — opening due positive, waiver negative).
 */
export interface MemberEntry {
  date: string;
  amount: number;
  kind: "contribution" | "adjustment";
}

export interface DueSummary {
  billed: number;
  contributed: number;
  adjusted: number;
  /** billed + adjustments − contributed. Negative means an Advance. */
  due: number;
  /** The Advance amount when due is negative, otherwise 0. */
  advance: number;
}

/**
 * The Member's running Due through a month (ADR-0001): total billed since the
 * joining month plus net Adjustments, minus total contributed. One number —
 * payments are never allocated to specific months.
 */
export function dueSummary(facts: MemberBillingFacts, entries: MemberEntry[], through: Month): DueSummary {
  let contributed = 0;
  let adjusted = 0;
  for (const entry of entries) {
    if (compareMonths(monthOfDate(entry.date), through) > 0) continue;
    if (entry.kind === "contribution") contributed += entry.amount;
    else adjusted += entry.amount;
  }
  const billed = billedBetween(facts, facts.joiningMonth, through);
  const due = billed + adjusted - contributed;

  return { billed, contributed, adjusted, due, advance: due < 0 ? -due : 0 };
}
