import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { z } from "zod";

import { HttpError, parseOr422, requireUser } from "../http";
import { assertMoneyOutCovers } from "../banks/service";

/** Transfer: money moved between the Team's own Bank Accounts (GLOSSARY.md). */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const createTransferBodySchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: z.number().int().min(1, "Amount must be at least ৳1"),
    date: dateString,
    note: z.string().trim().min(1).optional(),
  })
  .refine((body) => body.fromAccountId !== body.toAccountId, { message: "A Transfer needs two different Bank Accounts" });

export const updateTransferBodySchema = z
  .object({
    amount: z.number().int().min(1).optional(),
    date: dateString.optional(),
    note: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export interface TransferDeps {
  db: Database;
  session: Session | null;
}

export async function createTransfer(deps: TransferDeps, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createTransferBodySchema, body);

  const [from, to] = await Promise.all([
    deps.db.bankAccount.findFirst({ where: { id: input.fromAccountId, deletedAt: null } }),
    deps.db.bankAccount.findFirst({ where: { id: input.toAccountId, deletedAt: null } }),
  ]);
  if (!from || !to) throw new HttpError(404, "Bank Account not found");
  await assertMoneyOutCovers(deps.db, from, input.amount, "Transfer");

  return deps.db.transfer.create({
    data: {
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount,
      date: new Date(`${input.date}T00:00:00Z`),
      note: input.note,
      createdBy: user.id,
    },
  });
}

export async function updateTransfer(deps: TransferDeps, id: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(updateTransferBodySchema, body);
  const existing = await deps.db.transfer.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Transfer not found");
  const amount = input.amount ?? existing.amount;
  // The old transfer returns to the from-account first — only the delta must fit
  const from = await deps.db.bankAccount.findFirst({ where: { id: existing.fromAccountId, deletedAt: null } });
  if (!from) throw new HttpError(404, "Bank Account not found");
  await assertMoneyOutCovers(deps.db, from, amount - existing.amount, "Transfer");
  return deps.db.transfer.update({
    where: { id },
    data: {
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.date !== undefined ? { date: new Date(`${input.date}T00:00:00Z`) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedBy: user.id,
    },
  });
}

export async function softDeleteTransfer(deps: TransferDeps, id: string) {
  requireUser(deps.session);
  const existing = await deps.db.transfer.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Transfer not found");
  await deps.db.transfer.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
