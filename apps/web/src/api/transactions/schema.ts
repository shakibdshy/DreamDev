import { z } from "zod";

export const FEED_TYPES = ["contribution", "loan", "loan_repayment", "expense", "transfer", "adjustment"] as const;
export type FeedType = (typeof FEED_TYPES)[number];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const createContributionBodySchema = z.object({
  memberId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: z.number().int().min(1, "Amount must be at least ৳1"),
  creditDate: dateString,
  note: z.string().trim().min(1).optional(),
});

export const updateContributionBodySchema = z
  .object({
    bankAccountId: z.string().min(1).optional(),
    amount: z.number().int().min(1).optional(),
    creditDate: dateString.optional(),
    note: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export const listFeedQuerySchema = z.object({
  type: z.enum(FEED_TYPES).optional(),
  memberId: z.string().min(1).optional(),
  bankAccountId: z.string().min(1).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(["asc", "desc"]).default("desc"),
});
