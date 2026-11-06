import { z } from "zod";

export const accountNumberSchema = z.string().trim().min(1, "Account number cannot be blank").max(64, "Account number must be 64 characters or fewer");

export const createBankBodySchema = z.object({
  bankName: z.string().trim().min(1, "Bank name is required"),
  accountNumber: accountNumberSchema.optional(),
  address: z.string().trim().min(1).optional(),
  openingBalance: z.number().int().min(0).default(0),
});

export const updateBankBodySchema = z
  .object({
    bankName: z.string().trim().min(1).optional(),
    accountNumber: accountNumberSchema.nullable().optional(),
    address: z.string().trim().min(1).nullable().optional(),
    openingBalance: z.number().int().min(0).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export const listBanksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["bankName", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
