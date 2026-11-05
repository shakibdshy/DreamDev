import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { z } from "zod";

import { HttpError, parseOr422, requireUser } from "../http";

/** Expense: money out that isn't a Loan — bank charges, cash withdrawals (GLOSSARY.md). */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const createExpenseBodySchema = z.object({
  bankAccountId: z.string().min(1),
  amount: z.number().int().min(1, "Amount must be at least ৳1"),
  date: dateString,
  note: z.string().trim().min(1).optional(),
});

export const updateExpenseBodySchema = z
  .object({
    bankAccountId: z.string().min(1).optional(),
    amount: z.number().int().min(1).optional(),
    date: dateString.optional(),
    note: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export interface ExpenseDeps {
  db: Database;
  session: Session | null;
}

async function liveBank(db: Database, id: string) {
  const bank = await db.bankAccount.findFirst({ where: { id, deletedAt: null } });
  if (!bank) throw new HttpError(404, "Bank Account not found");
  return bank;
}

export async function createExpense(deps: ExpenseDeps, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createExpenseBodySchema, body);
  await liveBank(deps.db, input.bankAccountId);
  return deps.db.expense.create({
    data: { bankAccountId: input.bankAccountId, amount: input.amount, date: new Date(`${input.date}T00:00:00Z`), note: input.note, createdBy: user.id },
  });
}

export async function updateExpense(deps: ExpenseDeps, id: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(updateExpenseBodySchema, body);
  const existing = await deps.db.expense.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Expense not found");
  if (input.bankAccountId) await liveBank(deps.db, input.bankAccountId);
  return deps.db.expense.update({
    where: { id },
    data: {
      ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.date !== undefined ? { date: new Date(`${input.date}T00:00:00Z`) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedBy: user.id,
    },
  });
}

export async function softDeleteExpense(deps: ExpenseDeps, id: string) {
  requireUser(deps.session);
  const existing = await deps.db.expense.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Expense not found");
  await deps.db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
