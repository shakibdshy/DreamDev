import { compareMonths, monthRangeInclusive, type Month } from "./month";

/**
 * Billing rules (GLOSSARY.md, ADR-0001): each billable calendar month a Member
 * owes share quantity × share price. Quantity and price are effective-dated, so
 * a change applies from its month forward and past months never change.
 */
export interface ShareAllotment {
  effectiveMonth: Month;
  quantity: number;
}

export interface SharePriceEntry {
  effectiveMonth: Month;
  price: number;
}

/** Inactive interval, both bounds inclusive; `to` omitted means still inactive. */
export interface InactiveInterval {
  from: Month;
  to?: Month;
}

export interface MemberBillingFacts {
  joiningMonth: Month;
  /** Inclusive; billing stops after this month. */
  exitMonth?: Month;
  inactive?: InactiveInterval[];
  allotments: ShareAllotment[];
  prices: SharePriceEntry[];
}

/** The quantity active in a month: the latest allotment effective on or before it. */
export function quantityAt(allotments: ShareAllotment[], month: Month): number {
  let quantity = 0;
  for (const allotment of allotments) {
    if (compareMonths(allotment.effectiveMonth, month) <= 0) quantity = allotment.quantity;
  }
  return quantity;
}

/** The share price in a month: the latest price effective on or before it. */
export function priceAt(prices: SharePriceEntry[], month: Month): number {
  let price = 0;
  for (const entry of prices) {
    if (compareMonths(entry.effectiveMonth, month) <= 0) price = entry.price;
  }
  return price;
}

export function isBillableMonth(facts: MemberBillingFacts, month: Month): boolean {
  if (compareMonths(month, facts.joiningMonth) < 0) return false;
  if (facts.exitMonth && compareMonths(month, facts.exitMonth) > 0) return false;
  return !isInactive(facts.inactive ?? [], month);
}

function isInactive(intervals: InactiveInterval[], month: Month): boolean {
  return intervals.some(
    (interval) =>
      compareMonths(month, interval.from) >= 0 &&
      (interval.to === undefined || compareMonths(month, interval.to) <= 0),
  );
}

/** The bill for one month: quantity × price when billable, otherwise 0. */
export function billForMonth(facts: MemberBillingFacts, month: Month): number {
  if (!isBillableMonth(facts, month)) return 0;
  return quantityAt(facts.allotments, month) * priceAt(facts.prices, month);
}

/** Total billed over an inclusive month range. */
export function billedBetween(facts: MemberBillingFacts, from: Month, through: Month): number {
  return monthRangeInclusive(from, through).reduce(
    (total, month) => total + billForMonth(facts, month),
    0,
  );
}
