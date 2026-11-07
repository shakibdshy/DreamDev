import { z } from "zod";

import { ledgerDateSchema } from "../date-schema";

/** Bangladeshi mobile: 01 followed by 9 digits (3–9 as the operator digit). */
export const bdMobile = /^01[3-9]\d{8}$/;

export const memberStatusSchema = z.enum(["active", "inactive", "exited"]);

export const createMemberBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  mobile: z.string().trim().regex(bdMobile, "Enter a valid BD mobile (01XXXXXXXXX)"),
  joiningDate: ledgerDateSchema,
  shareQuantity: z.number().int().min(1, "At least 1 share").max(100),
  address: z.string().trim().min(1).optional(),
  photo: z.url().optional(), // Blob URL (ADR-0003), set via /api/uploads
  notes: z.string().trim().min(1).optional(),
});

export const updateMemberBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    mobile: z.string().trim().regex(bdMobile, "Enter a valid BD mobile (01XXXXXXXXX)").optional(),
    joiningDate: ledgerDateSchema.optional(),
    address: z.string().trim().min(1).nullable().optional(),
    photo: z.url().nullable().optional(),
    notes: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export const changeSharesBodySchema = z.object({
  quantity: z.number().int().min(1).max(100),
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(), // defaults to the current month; future months are legitimate
});

export const setStatusBodySchema = z.object({
  status: memberStatusSchema,
  date: ledgerDateSchema, // effective date of the change
  note: z.string().trim().min(1).optional(),
});

export const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.enum(["name", "mobile", "joiningDate", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().min(1).optional(),
});
