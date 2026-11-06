import { billForMonth, type MemberBillingFacts } from "./billing";
import type { MemberEntry } from "./due";
import { compareMonths, monthOfDate, monthRangeInclusive, type Month } from "./month";

/**
 * The member×month projection (ADR-0001): a display-only walk of a Member's
 * entries against their monthly bills. True FIFO — each Contribution retires
 * the oldest uncovered bill, no matter when the Contribution is dated; what
 * remains after every bill through `through` is the Advance. Not stored data;
 * recomputed on demand.
 */
export type MonthCellStatus = "not-billed" | "due" | "partial" | "paid" | "advance";

export interface MonthCell {
  month: Month;
  /** What the month effectively owes: the bill plus signed Adjustments (never below 0). */
  bill: number;
  /** How much of the bill was covered, from the FIFO walk plus rolled-in debt. */
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

  // Walk from the earliest month that can affect the range (membership start or
  // the first entry), so a payment always reaches bills before `from`.
  const firstEntryMonth = ordered[0] ? monthOfDate(ordered[0].date) : undefined;
  const walkFrom =
    [facts.joiningMonth, firstEntryMonth, from]
      .filter((month): month is Month => month !== undefined && compareMonths(month, through) <= 0)
      .sort(compareMonths)[0] ?? from;

  const months = monthRangeInclusive(walkFrom, through);
  const bills = months.map((month) => {
    const { adjustment = 0 } = byMonth.get(month) ?? {};
    return Math.max(0, billForMonth(facts, month) + adjustment);
  });
  const remaining = [...bills];

  // Allocate Contributions chronologically, oldest uncovered bill first.
  let leftover = 0;
  for (const entry of ordered) {
    if (entry.kind !== "contribution") continue;
    let left = entry.amount;
    for (let i = 0; i < months.length && left > 0; i++) {
      const paid = Math.min(remaining[i]!, left);
      remaining[i]! -= paid;
      left -= paid;
    }
    leftover += left;
  }
  const paid = months.map((_, i) => bills[i]! - remaining[i]!);

  // Debt from before `from` rolls into the first visible month so the range
  // never looks cleaner than the Due it derives from.
  let rolledUnpaid = 0;
  let rolledPaid = 0;
  const cells: MonthCell[] = [];
  for (let i = 0; i < months.length; i++) {
    const month = months[i]!;
    if (compareMonths(month, from) < 0) {
      rolledUnpaid += remaining[i]!;
      rolledPaid += paid[i]!;
      continue;
    }
    const first = cells.length === 0;
    const bill = bills[i]! + (first ? rolledUnpaid : 0);
    const applied = Math.min(bill, paid[i]! + (first ? rolledPaid : 0));
    const contribution = byMonth.get(month)?.contribution ?? 0;

    let status: MonthCellStatus;
    if (bill === 0) status = contribution > 0 ? "advance" : "not-billed";
    else if (applied >= bill) status = "paid";
    else if (applied > 0) status = "partial";
    else status = "due";

    cells.push({ month, bill, applied, status });
  }

  // Money beyond every bill through `through` is the Advance; it surfaces on
  // the last visible month (the Due exposes the same number).
  const last = cells[cells.length - 1];
  if (leftover > 0 && last && (last.status === "paid" || last.status === "not-billed")) {
    last.status = "advance";
  }

  return cells;
}
