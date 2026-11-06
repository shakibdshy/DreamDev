import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { monthOfDate } from "@DreamDev/db/domain/month";
import { z } from "zod";

import { HttpError, parseOr422, requireUser } from "../http";
import { getPriceEntries } from "../members/billing-facts";

export interface SettingsDeps {
  db: Database;
  session: Session | null;
}

export const sharePriceBodySchema = z.object({
  sharePrice: z.number().int().min(1, "Share Price must be whole taka, at least ৳1"),
});

/** The current global Share Price (GLOSSARY.md): the latest effective-dated entry. */
export async function getSharePrice(deps: SettingsDeps) {
  requireUser(deps.session);
  const prices = await getPriceEntries(deps.db);
  const latest = prices[prices.length - 1]!;
  return { sharePrice: latest.price, effectiveMonth: latest.effectiveMonth };
}

/**
 * Admin-only. Appends an effective-dated price entry: past months never re-bill
 * (ADR-0001/GLOSSARY), existing Contribution snapshots are untouched, and new
 * Contributions snapshot the new price.
 */
export async function updateSharePrice(deps: SettingsDeps, body: unknown) {
  const user = requireUser(deps.session);
  if (user.role !== "admin") throw new HttpError(403, "Admin role required");
  const { sharePrice } = parseOr422(sharePriceBodySchema, body);

  const prices = await getPriceEntries(deps.db);
  const latest = prices[prices.length - 1]!;
  const effectiveMonth = monthOfDate(new Date());

  if (latest.price === sharePrice) {
    return { sharePrice: latest.price, effectiveMonth: latest.effectiveMonth, changed: false };
  }

  // One entry per month: changing the price twice in a month updates this month's entry
  const existingThisMonth = await deps.db.sharePriceEntry.findUnique({ where: { effectiveMonth } });
  const entry = existingThisMonth
    ? await deps.db.sharePriceEntry.update({ where: { effectiveMonth }, data: { price: sharePrice } })
    : await deps.db.sharePriceEntry.create({ data: { effectiveMonth, price: sharePrice } });

  return { sharePrice: entry.price, effectiveMonth: entry.effectiveMonth, changed: true };
}
