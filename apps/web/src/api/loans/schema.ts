import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const createLoanBodySchema = z.object({
  memberId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: z.number().int().min(1, "Amount must be at least ৳1"),
  date: dateString,
  note: z.string().trim().min(1).optional(),
});

export const createRepaymentBodySchema = z.object({
  bankAccountId: z.string().min(1),
  amount: z.number().int().min(1, "Amount must be at least ৳1"),
  creditDate: dateString,
});

export const SOFT_CAP_MULTIPLIER = 2; // warn past 2× total contributions (spec: warn, don't block)
