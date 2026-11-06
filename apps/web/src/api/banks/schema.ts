import { z } from "zod";

export const createBankBodySchema = z.object({
  bankName: z.string().trim().min(1, "Bank name is required"),
  address: z.string().trim().min(1).optional(),
  openingBalance: z.number().int().min(0).default(0),
});

export const updateBankBodySchema = z
  .object({
    bankName: z.string().trim().min(1).optional(),
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
