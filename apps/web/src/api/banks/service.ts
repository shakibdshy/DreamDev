import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { currentBalance, type BankEntryType } from "@DreamDev/db/domain/balance";
import { formatTaka } from "@DreamDev/db/domain/money";

import { HttpError, parseOr422, requireUser } from "../http";
import { createBankBodySchema, listBanksQuerySchema, updateBankBodySchema } from "./schema";

export interface BanksDeps {
  db: Database;
  session: Session | null;
}

/** Editors and Admins both manage Bank Accounts (spec); Members never log in. */
function requireAdmin(session: Session | null) {
  const user = requireUser(session);
  if (user.role !== "admin") throw new HttpError(403, "Admin role required");
  return user;
}

const publicAccount = {
  id: true,
  bankName: true,
  accountNumber: true,
  address: true,
  openingBalance: true,
  createdAt: true,
} as const;

export interface BankAccountItem {
  id: string;
  bankName: string;
  accountNumber: string | null;
  address: string | null;
  openingBalance: number;
  /** Derived: Opening Balance + money in − money out (GLOSSARY.md, never stored). */
  currentBalance: number;
  createdAt: Date;
}

/**
 * Groups every ledger table's live sums per account and folds them through the
 * domain's pure currentBalance — the SQL side of ADR-0002's unified read model.
 */
export async function ledgerDeltasByAccount(db: Database, accountIds: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>(accountIds.map((id) => [id, 0]));
  const byAccount = new Map<string, { type: BankEntryType; amount: number }[]>();
  const add = (accountId: string | null | undefined, type: BankEntryType, amount: number) => {
    if (!accountId || !balances.has(accountId)) return;
    const entries = byAccount.get(accountId) ?? [];
    entries.push({ type, amount });
    byAccount.set(accountId, entries);
  };

  const [contributions, loans, repayments, expenses, transfersOut, transfersIn] = await Promise.all([
    db.contribution.groupBy({ by: ["bankAccountId"], _sum: { amount: true }, where: { deletedAt: null } }),
    db.loan.groupBy({ by: ["bankAccountId"], _sum: { amount: true }, where: { deletedAt: null } }),
    db.loanRepayment.groupBy({ by: ["bankAccountId"], _sum: { amount: true }, where: { deletedAt: null } }),
    db.expense.groupBy({ by: ["bankAccountId"], _sum: { amount: true }, where: { deletedAt: null } }),
    db.transfer.groupBy({ by: ["fromAccountId"], _sum: { amount: true }, where: { deletedAt: null } }),
    db.transfer.groupBy({ by: ["toAccountId"], _sum: { amount: true }, where: { deletedAt: null } }),
  ]);

  for (const row of contributions) add(row.bankAccountId, "contribution", row._sum.amount ?? 0);
  for (const row of repayments) add(row.bankAccountId, "loan_repayment", row._sum.amount ?? 0);
  for (const row of transfersIn) add(row.toAccountId, "transfer_in", row._sum.amount ?? 0);
  for (const row of loans) add(row.bankAccountId, "loan", row._sum.amount ?? 0);
  for (const row of expenses) add(row.bankAccountId, "expense", row._sum.amount ?? 0);
  for (const row of transfersOut) add(row.fromAccountId, "transfer_out", row._sum.amount ?? 0);

  for (const [accountId, entries] of byAccount) {
    balances.set(accountId, currentBalance(0, entries));
  }
  return balances;
}

/** One account's live Current Balance (GLOSSARY.md) — the guard for money-out entries. */
export async function currentBalanceOf(
  db: Database,
  account: { id: string; bankName: string; openingBalance: number },
): Promise<number> {
  const deltas = await ledgerDeltasByAccount(db, [account.id]);
  return account.openingBalance + (deltas.get(account.id) ?? 0);
}

/**
 * Hard rule for every money-out entry (Loan, Expense, Transfer, and edits that
 * shrink a Contribution): the amount must fit the account's available balance,
 * so a ledger entry can never drive a Bank Account negative.
 */
export async function assertMoneyOutCovers(
  db: Database,
  account: { id: string; bankName: string; openingBalance: number },
  amount: number,
  label: string,
): Promise<void> {
  const balance = await currentBalanceOf(db, account);
  if (amount > balance) {
    throw new HttpError(
      422,
      `${label} of ${formatTaka(amount)} exceeds ${account.bankName}'s available balance of ${formatTaka(balance)}`,
    );
  }
}

/** Paginated list of live accounts with computed Current Balances. */
export async function listBanks(deps: BanksDeps, query: unknown): Promise<{ data: BankAccountItem[]; meta: { page: number; pageSize: number; total: number } }> {
  requireUser(deps.session);
  const { page, pageSize, sort, order } = parseOr422(listBanksQuerySchema, query);

  const [accounts, total] = await Promise.all([
    deps.db.bankAccount.findMany({
      where: { deletedAt: null },
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    deps.db.bankAccount.count({ where: { deletedAt: null } }),
  ]);

  const deltas = await ledgerDeltasByAccount(
    deps.db,
    accounts.map((a) => a.id),
  );

  return {
    data: accounts.map(({ id, bankName, accountNumber, address, openingBalance, createdAt }) => ({
      id,
      bankName,
      accountNumber,
      address,
      openingBalance,
      currentBalance: openingBalance + (deltas.get(id) ?? 0),
      createdAt,
    })),
    meta: { page, pageSize, total },
  };
}

export async function createBank(deps: BanksDeps, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createBankBodySchema, body);
  return deps.db.bankAccount.create({
    data: { bankName: input.bankName, accountNumber: input.accountNumber, address: input.address, openingBalance: input.openingBalance, createdBy: user.id },
    select: publicAccount,
  });
}

export async function updateBank(deps: BanksDeps, id: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(updateBankBodySchema, body);
  const target = await deps.db.bankAccount.findUnique({ where: { id } });
  if (!target || target.deletedAt) throw new HttpError(404, "Bank Account not found");
  return deps.db.bankAccount.update({ where: { id }, data: { ...input, updatedBy: user.id }, select: publicAccount });
}

/** Soft-delete hides the account from lists while preserving history. */
export async function softDeleteBank(deps: BanksDeps, id: string) {
  requireUser(deps.session);
  const target = await deps.db.bankAccount.findUnique({ where: { id } });
  if (!target || target.deletedAt) throw new HttpError(404, "Bank Account not found");
  await deps.db.bankAccount.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

/** Hard-delete (Admin only) — refused while any ledger entry references the account. */
export async function purgeBank(deps: BanksDeps, id: string) {
  requireAdmin(deps.session);
  const target = await deps.db.bankAccount.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, "Bank Account not found");

  const [contributions, loans, repayments, expenses, transfers] = await Promise.all([
    deps.db.contribution.count({ where: { bankAccountId: id } }),
    deps.db.loan.count({ where: { bankAccountId: id } }),
    deps.db.loanRepayment.count({ where: { bankAccountId: id } }),
    deps.db.expense.count({ where: { bankAccountId: id } }),
    deps.db.transfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } }),
  ]);
  const entries = contributions + loans + repayments + expenses + transfers;
  if (entries > 0) {
    throw new HttpError(409, `Cannot delete: ${entries} ledger entr${entries === 1 ? "y" : "ies"} reference this account`);
  }

  await deps.db.bankAccount.delete({ where: { id } });
  return { ok: true };
}
