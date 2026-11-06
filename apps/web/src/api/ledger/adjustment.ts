import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { z } from "zod";

import { HttpError, parseOr422, requireUser } from "../http";

/**
 * Adjustment: the Admin-only honest-correction mechanism (GLOSSARY.md) —
 * opening dues positive, waived months negative; the amount is the correction,
 * the optional month is a label.
 */

import { notifyMemberEvent } from "@/telegram/notify";

export const createAdjustmentBodySchema = z
  .object({
    memberId: z.string().min(1),
    amount: z.number().int().refine((v) => v !== 0, "An Adjustment must be non-zero"),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    reason: z.string().trim().min(1, "A reason is required"),
  })
  .refine((body) => !body.month || body.amount > 0 || body.amount < 0, { message: "unreachable" });

export const updateAdjustmentBodySchema = z
  .object({
    amount: z.number().int().refine((v) => v !== 0, "An Adjustment must be non-zero").optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export interface AdjustmentDeps {
  db: Database;
  session: Session | null;
}

function requireAdmin(session: Session | null) {
  const user = requireUser(session);
  if (user.role !== "admin") throw new HttpError(403, "Adjustments are Admin-only");
  return user;
}

export async function createAdjustment(deps: AdjustmentDeps, body: unknown) {
  const user = requireAdmin(deps.session);
  const input = parseOr422(createAdjustmentBodySchema, body);

  const member = await deps.db.member.findUnique({ where: { id: input.memberId } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");

  const adjustment = await deps.db.adjustment.create({
    data: { memberId: input.memberId, amount: input.amount, month: input.month, reason: input.reason, createdBy: user.id },
  });
  await notifyMemberEvent({ db: deps.db }, { memberId: input.memberId, type: "adjustment_recorded", recordId: adjustment.id });
  return adjustment;
}

export async function updateAdjustment(deps: AdjustmentDeps, id: string, body: unknown) {
  const user = requireAdmin(deps.session);
  const input = parseOr422(updateAdjustmentBodySchema, body);
  const existing = await deps.db.adjustment.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Adjustment not found");
  const updated = await deps.db.adjustment.update({
    where: { id },
    data: {
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.month !== undefined ? { month: input.month } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      updatedBy: user.id,
    },
  });
  await notifyMemberEvent({ db: deps.db }, { memberId: existing.memberId, type: "adjustment_updated", recordId: id });
  return updated;
}

export async function softDeleteAdjustment(deps: AdjustmentDeps, id: string) {
  requireAdmin(deps.session);
  const existing = await deps.db.adjustment.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Adjustment not found");
  await deps.db.adjustment.update({ where: { id }, data: { deletedAt: new Date() } });
  await notifyMemberEvent({ db: deps.db }, { memberId: existing.memberId, type: "adjustment_deleted", recordId: id });
  return { ok: true };
}
