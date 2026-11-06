import type { Database } from "@DreamDev/db";
import type { InactiveInterval, MemberBillingFacts, ShareAllotment, SharePriceEntry } from "@DreamDev/db/domain/billing";
import { monthOfDate } from "@DreamDev/db/domain/month";

/**
 * Assembles MemberBillingFacts from stored rows: allotments as stored, price
 * history from SharePriceEntry, and Inactive intervals derived from the status
 * change log. Shared by list, detail, and later the dashboard.
 */

export interface MemberRow {
  id: string;
  joiningDate: Date;
  exitDate: Date | null;
  status: string;
}

export interface StatusChangeRow {
  memberId: string;
  status: string;
  date: Date;
}

export async function getPriceEntries(db: Database): Promise<SharePriceEntry[]> {
  const entries = await db.sharePriceEntry.findMany({ orderBy: { effectiveMonth: "asc" } });
  if (entries.length > 0) return entries;
  try {
    return [await db.sharePriceEntry.create({ data: { effectiveMonth: "1970-01", price: 5000 } })];
  } catch {
    // Two first requests raced on the unique key — the winner's row is correct
    return db.sharePriceEntry.findMany({ orderBy: { effectiveMonth: "asc" } });
  }
}

/** Inactive intervals from the status log: each inactive stretch until the next change (open-ended if still inactive). */
export function inactiveIntervals(statusChanges: StatusChangeRow[]): InactiveInterval[] {
  const ordered = [...statusChanges].sort((a, b) => a.date.getTime() - b.date.getTime());
  const intervals: InactiveInterval[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const change = ordered[i]!;
    if (change.status !== "inactive") continue;
    const next = ordered[i + 1];
    intervals.push(
      next
        ? { from: monthOfDate(change.date), to: monthOfDate(next.date) }
        : { from: monthOfDate(change.date) }, // still inactive (or superseded by a later same-status row)
    );
  }
  return intervals;
}

/** Folds stored Contribution/Adjustment rows into domain MemberEntry shape. */
export function toMemberEntries(
  contributions: { creditDate: Date; amount: number }[],
  adjustments: { month: string | null; createdAt: Date; amount: number }[],
) {
  return [
    ...contributions.map((c) => ({ date: c.creditDate.toISOString().slice(0, 10), amount: c.amount, kind: "contribution" as const })),
    ...adjustments.map((a) => ({
      date: a.month ? `${a.month}-15` : a.createdAt.toISOString().slice(0, 10),
      amount: a.amount,
      kind: "adjustment" as const,
    })),
  ];
}

export function memberFacts(
  member: MemberRow,
  allotments: ShareAllotment[],
  prices: SharePriceEntry[],
  statusChanges: StatusChangeRow[],
): MemberBillingFacts {
  return {
    joiningMonth: monthOfDate(member.joiningDate),
    exitMonth: member.exitDate ? monthOfDate(member.exitDate) : undefined,
    inactive: inactiveIntervals(statusChanges),
    allotments,
    prices,
  };
}
