import { z } from "zod";

import { todayInDhaka } from "@DreamDev/db/domain/month";

/**
 * A ledger day: a real `YYYY-MM-DD` calendar date, today (Asia/Dhaka) or
 * earlier. The domain never records future dates (spec 2026-11-07); the agent
 * sanity layer and the dashboard DatePicker enforce the same rule.
 */
export const ledgerDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, "Choose a real calendar date")
  .refine((value) => value <= todayInDhaka(), "Date can't be in the future");
