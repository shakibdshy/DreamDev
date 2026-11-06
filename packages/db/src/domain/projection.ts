import { billForMonth, type MemberBillingFacts } from "./billing";
import type { MemberEntry } from "./due";
import { compareMonths, monthOfDate, monthRangeInclusive, type Month } from "./month";

/**
 * The member×month projection (ADR-0001): a display-only walk of a Member's
 * entries against their monthly bills, FIFO — oldest uncovered bill first.
 * Not stored data; recomputed on demand.
 */
export type MonthCellStatus = "not-billed" | "due" | "partial" | "paid" | "advance";

export interface MonthCell {
  month: Month;
  /** What the month effectively owes: the bill plus signed Adjustments (never below 0). */
  bill: number;
  /** How much of the bill was covered, from that month's Contributions plus carry. */
  applied: number;
  status: MonthCellStatus;
}

export function projectMonths(
  facts: MemberBillingFacts,
  entries: MemberEntry[],
  from: Month,
  through: Month,
): MonthCell[] {
  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map<Month, { contribution: number; adjustment: number }>();
  for (const entry of ordered) {
    const month = monthOfDate(entry.date);
    const bucket = byMonth.get(month) ?? { contribution: 0, adjustment: 0 };
    if (entry.kind === "contribution") bucket.contribution += entry.amount;
    else bucket.adjustment += entry.amount;
    byMonth.set(month, bucket);
  }

  // Walk from the earliest month that can affect carry (membership start or
  // the first entry), so overpayment before `from` still seeds the range.
  const firstEntryMonth = ordered[0] ? monthOfDate(ordered[0].date) : undefined;
  const walkFrom =
    [facts.joiningMonth, firstEntryMonth, from]
      .filter((month): month is Month => month !== undefined && compareMonths(month, through) <= 0)
      .sort(compareMonths)[0] ?? from;

  let carry = 0;
  // Debt owed from before the range (unpaid bills, opening-due Adjustments)
  // surfaces in the first projected month, keeping the walk consistent with the Due.
  let preRangeDebt = 0;

  const cells = monthRangeInclusive(walkFrom, through).map((month): MonthCell => {
    const bill = billForMonth(facts, month);
    const { contribution = 0, adjustment = 0 } = byMonth.get(month) ?? {};
    let effectiveBill = Math.max(0, bill + adjustment);

    const inRange = compareMonths(month, from) >= 0;
    if (inRange && preRangeDebt > 0) {
      effectiveBill += preRangeDebt;
      preRangeDebt = 0;
    }

    const available = contribution + carry;
    const applied = Math.min(effectiveBill, available);
    carry = available - applied;
    if (!inRange) preRangeDebt += effectiveBill - applied;

    let status: MonthCellStatus;
    if (effectiveBill === 0) status = contribution > 0 ? "advance" : "not-billed";
    else if (applied === effectiveBill) status = carry > 0 ? "advance" : "paid";
    else if (applied > 0) status = "partial";
    else status = "due";

    return { month, bill: effectiveBill, applied, status };
  });

  return cells.filter((cell) => compareMonths(cell.month, from) >= 0);
}
