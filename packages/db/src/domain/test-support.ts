import type { MemberBillingFacts, ShareAllotment, SharePriceEntry } from "./billing";

/** Shared fixtures for domain tests — one place for the fund's baseline facts. */
export const at5000: SharePriceEntry[] = [{ effectiveMonth: "2026-01", price: 5000 }];

export const threeShares: ShareAllotment[] = [{ effectiveMonth: "2026-01", quantity: 3 }];

/** A Member with 1 Share at ৳5,000, joined 2026-01, active — override what each test needs. */
export function memberFacts(overrides: Partial<MemberBillingFacts> = {}): MemberBillingFacts {
  return {
    joiningMonth: "2026-01",
    allotments: [{ effectiveMonth: "2026-01", quantity: 1 }],
    prices: at5000,
    ...overrides,
  };
}
