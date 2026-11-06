import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

/**
 * Contribution tools shared by the server (bindings in tools.ts) and the chat
 * panel (types for the approval card) — ticket 4/8. The confirm gate: the
 * model previews first, then proposes; the proposal pauses until a human
 * approves, and only then does the service write.
 */

const MAX_AMOUNT = 10_000_000; // ৳1 crore sanity cap (spec guardrail 6)
const MAX_FUTURE_DAYS = 35;

/** YYYY-MM-DD at most 35 days in the future (Credit Dates can't be guesses). */
const creditDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const today = new Date();
    const date = new Date(`${value}T00:00:00Z`);
    const future = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + MAX_FUTURE_DAYS));
    return date.getTime() <= future.getTime();
  }, `Credit Date can be at most ${MAX_FUTURE_DAYS} days in the future`);

export const contributionInputSchema = z.object({
  memberId: z.string().min(1).meta({ description: "Member id from list_members" }),
  bankAccountId: z.string().min(1).meta({ description: "Bank Account id from list_banks" }),
  amount: z
    .number()
    .int("Amount must be whole taka")
    .min(1, "Amount must be at least ৳1")
    .max(MAX_AMOUNT, `Amount cannot exceed ৳${MAX_AMOUNT.toLocaleString("en-IN")}`),
  creditDate: creditDateSchema,
  note: z.string().trim().min(1).max(500).optional(),
});

export interface ContributionPreview {
  memberName: string;
  bankName: string;
  amount: number;
  creditDate: string;
  dueBefore: number;
  dueAfter: number;
  advanceAfter: number;
  sharePrice: number;
  shares: number;
}

export const previewContributionDef = toolDefinition({
  name: "preview_contribution",
  description:
    "Preview a Contribution before recording it: resolves the Member and Bank Account names and shows the current Due and what it becomes after this payment. Always call this before record_contribution, with identical arguments.",
  inputSchema: contributionInputSchema,
  outputSchema: z.looseObject({
    memberName: z.string(),
    bankName: z.string(),
    amount: z.number(),
    creditDate: z.string(),
    dueBefore: z.number(),
    dueAfter: z.number(),
    advanceAfter: z.number(),
    sharePrice: z.number(),
    shares: z.number(),
  }),
});

export const recordContributionDef = toolDefinition({
  name: "record_contribution",
  description:
    "Record a Contribution in the ledger. PAUSES FOR USER APPROVAL — the confirm card shows the canonical values from preview_contribution. Nothing is written unless the user approves the card.",
  inputSchema: contributionInputSchema,
  outputSchema: z.looseObject({
    recorded: z.boolean(),
    contributionId: z.string(),
    memberName: z.string(),
    amount: z.number(),
    creditDate: z.string(),
  }),
  needsApproval: true,
});
