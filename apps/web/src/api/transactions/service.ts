import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

import { HttpError, parseOr422, requireUser } from "../http";
import { assertMoneyOutCovers } from "../banks/service";
import { getPriceEntries, memberFacts, toMemberEntries } from "../members/billing-facts";
import { dueSummary } from "@DreamDev/db/domain/due";
import { monthOfDate } from "@DreamDev/db/domain/month";
import { createContributionBodySchema, listFeedQuerySchema, updateContributionBodySchema } from "./schema";
import { notifyMemberEvent } from "@/telegram/notify";

export interface TxnDeps {
  db: Database;
  session: Session | null;
}

/** One row of the unified Transactions feed (ADR-0002 read model over typed tables). */
export interface FeedEntry {
  id: string;
  type: "contribution" | "loan" | "loan_repayment" | "expense" | "transfer" | "adjustment";
  date: string; // YYYY-MM-DD
  /** Signed from the fund's perspective: money in positive, money out negative; Adjustments as stored. */
  amount: number;
  memberId: string | null;
  memberName: string | null;
  bankName: string | null;
  toBankName: string | null; // Transfers only
  note: string | null;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Unified feed across all six entry types. Each type is fetched with the same
 * filters (one query each, fields only), merged and sorted in JS, then paged —
 * right-sized for a single team's ledger.
 */
export async function listFeed(deps: TxnDeps, query: unknown) {
  requireUser(deps.session);
  const { type, memberId, bankAccountId, from, to, page, pageSize, order } = parseOr422(listFeedQuerySchema, query);
  const dateRange = { gte: from ? new Date(`${from}T00:00:00Z`) : undefined, lte: to ? new Date(`${to}T00:00:00Z`) : undefined };
  const where = (extra: Record<string, unknown>) => ({ deletedAt: null, ...extra });
  const expenseBank = bankAccountId ? { bankAccountId } : {};
  const transferBank = bankAccountId ? { OR: [{ fromAccountId: bankAccountId }, { toAccountId: bankAccountId }] } : {};

  const wants = (t: FeedEntry["type"]) => !type || type === t;

  const [contributions, loans, repayments, expenses, transfers, adjustments] = await Promise.all([
    wants("contribution")
      ? deps.db.contribution.findMany({
          where: where({ ...(memberId ? { memberId } : {}), ...(bankAccountId ? { bankAccountId } : {}), creditDate: dateRange }),
        })
      : [],
    wants("loan")
      ? deps.db.loan.findMany({ where: where({ ...(memberId ? { memberId } : {}), ...(bankAccountId ? { bankAccountId } : {}), date: dateRange }) })
      : [],
    wants("loan_repayment")
      ? deps.db.loanRepayment.findMany({
          where: where({ ...(memberId ? { memberId } : {}), ...(bankAccountId ? { bankAccountId } : {}), creditDate: dateRange }),
        })
      : [],
    // Expenses and Transfers have no Member — a memberId filter excludes them entirely
    wants("expense") && !memberId ? deps.db.expense.findMany({ where: where({ ...expenseBank, date: dateRange }) }) : [],
    wants("transfer") && !memberId ? deps.db.transfer.findMany({ where: where({ ...transferBank, date: dateRange }) }) : [],
    wants("adjustment") ? deps.db.adjustment.findMany({ where: where({ ...(memberId ? { memberId } : {}) }) }) : [],
  ]);

  const memberIds = new Set(
    [...contributions, ...loans, ...repayments, ...adjustments].map((r: { memberId: string }) => r.memberId),
  );
  const bankIds = new Set<string>();
  for (const rows of [contributions, loans, repayments, expenses]) {
    for (const row of rows as { bankAccountId: string }[]) bankIds.add(row.bankAccountId);
  }
  for (const t of transfers as { fromAccountId: string; toAccountId: string }[]) {
    bankIds.add(t.fromAccountId);
    bankIds.add(t.toAccountId);
  }

  const [members, banks] = await Promise.all([
    memberIds.size ? deps.db.member.findMany({ where: { id: { in: [...memberIds] } } }) : [],
    bankIds.size ? deps.db.bankAccount.findMany({ where: { id: { in: [...bankIds] } } }) : [],
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.bankName]));

  const entries: FeedEntry[] = [
    ...contributions.map(
      (c): FeedEntry => ({
        id: c.id,
        type: "contribution",
        date: day(c.creditDate),
        amount: c.amount,
        memberId: c.memberId,
        memberName: memberName.get(c.memberId) ?? null,
        bankName: bankName.get(c.bankAccountId) ?? null,
        toBankName: null,
        note: c.note,
      }),
    ),
    ...loans.map(
      (l): FeedEntry => ({
        id: l.id,
        type: "loan",
        date: day(l.date),
        amount: -l.amount,
        memberId: l.memberId,
        memberName: memberName.get(l.memberId) ?? null,
        bankName: bankName.get(l.bankAccountId) ?? null,
        toBankName: null,
        note: l.note,
      }),
    ),
    ...repayments.map(
      (r): FeedEntry => ({
        id: r.id,
        type: "loan_repayment",
        date: day(r.creditDate),
        amount: r.amount,
        memberId: r.memberId,
        memberName: memberName.get(r.memberId) ?? null,
        bankName: bankName.get(r.bankAccountId) ?? null,
        toBankName: null,
        note: null,
      }),
    ),
    ...expenses.map(
      (e): FeedEntry => ({
        id: e.id,
        type: "expense",
        date: day(e.date),
        amount: -e.amount,
        memberId: null,
        memberName: null,
        bankName: bankName.get(e.bankAccountId) ?? null,
        toBankName: null,
        note: e.note,
      }),
    ),
    ...transfers.map(
      (t): FeedEntry => ({
        id: t.id,
        type: "transfer",
        date: day(t.date),
        amount: -t.amount,
        memberId: null,
        memberName: null,
        bankName: bankName.get(t.fromAccountId) ?? null,
        toBankName: bankName.get(t.toAccountId) ?? null,
        note: t.note,
      }),
    ),
    ...adjustments.map(
      (a): FeedEntry => ({
        id: a.id,
        type: "adjustment",
        date: a.month ? `${a.month}-15` : day(a.createdAt),
        amount: a.amount,
        memberId: a.memberId,
        memberName: memberName.get(a.memberId) ?? null,
        bankName: null,
        toBankName: null,
        note: a.reason,
      }),
    ),
  ];

  // Adjustments carry their own dates — apply the date range uniformly in the merge
  const ranged = entries.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  ranged.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : order === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));

  const total = ranged.length;
  const data = ranged.slice((page - 1) * pageSize, page * pageSize);
  return { data, meta: { page, pageSize, total } };
}

/** Current position for the Contribution form's disabled Due field. */
export async function memberPosition(deps: TxnDeps, memberId: string) {
  requireUser(deps.session);
  const member = await deps.db.member.findUnique({ where: { id: memberId } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");

  const [allotments, statusChanges, prices, contributions, adjustments] = await Promise.all([
    deps.db.shareAllotment.findMany({ where: { memberId }, orderBy: { effectiveMonth: "asc" } }),
    deps.db.memberStatusChange.findMany({ where: { memberId } }),
    getPriceEntries(deps.db),
    deps.db.contribution.findMany({ where: { memberId, deletedAt: null } }),
    deps.db.adjustment.findMany({ where: { memberId, deletedAt: null } }),
  ]);

  const facts = memberFacts(member, allotments, prices, statusChanges);
  const entries = toMemberEntries(contributions, adjustments);
  const summary = dueSummary(facts, entries, monthOfDate(new Date()));

  return {
    memberId,
    name: member.name,
    shares: allotments[allotments.length - 1]?.quantity ?? 0,
    sharePrice: prices[prices.length - 1]?.price ?? 0,
    due: summary.due,
    advance: summary.advance,
  };
}

/** Creates a Contribution, snapshotting the Share Price and quantity at entry (GLOSSARY.md). */
export async function createContribution(deps: TxnDeps, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createContributionBodySchema, body);

  const [member, bank, prices, allotments] = await Promise.all([
    deps.db.member.findUnique({ where: { id: input.memberId } }),
    deps.db.bankAccount.findFirst({ where: { id: input.bankAccountId, deletedAt: null } }),
    getPriceEntries(deps.db),
    deps.db.shareAllotment.findMany({ where: { memberId: input.memberId }, orderBy: { effectiveMonth: "asc" } }),
  ]);
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");
  if (!bank) throw new HttpError(404, "Bank Account not found");

  const sharePrice = prices[prices.length - 1]?.price ?? 5000;
  const shareQty = allotments[allotments.length - 1]?.quantity ?? 0;

  const contribution = await deps.db.contribution.create({
    data: {
      memberId: input.memberId,
      bankAccountId: input.bankAccountId,
      amount: input.amount,
      creditDate: new Date(`${input.creditDate}T00:00:00Z`),
      sharePriceAtEntry: sharePrice,
      shareQtyAtEntry: shareQty,
      note: input.note,
      createdBy: user.id,
    },
  });
  // Member DM (dashboard AND agent writes) — awaited but never failing the write.
  await notifyMemberEvent({ db: deps.db }, { memberId: input.memberId, type: "contribution_recorded", recordId: contribution.id });
  return contribution;
}

/** Edits a Contribution. The price/quantity snapshot is history and never changes. */
export async function updateContribution(deps: TxnDeps, id: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(updateContributionBodySchema, body);

  const existing = await deps.db.contribution.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Contribution not found");

  if (input.bankAccountId) {
    const bank = await deps.db.bankAccount.findFirst({ where: { id: input.bankAccountId, deletedAt: null } });
    if (!bank) throw new HttpError(404, "Bank Account not found");
  }

  // Shrinking or moving a Contribution takes money out of the old account —
  // the same balance rule as any other money-out edit.
  const nextBankId = input.bankAccountId ?? existing.bankAccountId;
  const nextAmount = input.amount ?? existing.amount;
  if (nextBankId === existing.bankAccountId) {
    if (nextAmount < existing.amount) {
      const bank = await deps.db.bankAccount.findFirst({ where: { id: existing.bankAccountId, deletedAt: null } });
      if (!bank) throw new HttpError(404, "Bank Account not found");
      await assertMoneyOutCovers(deps.db, bank, existing.amount - nextAmount, "Contribution reduction");
    }
  } else {
    const oldBank = await deps.db.bankAccount.findFirst({ where: { id: existing.bankAccountId, deletedAt: null } });
    if (oldBank) await assertMoneyOutCovers(deps.db, oldBank, existing.amount, "Contribution move");
  }

  const updated = await deps.db.contribution.update({
    where: { id },
    data: {
      ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.creditDate !== undefined ? { creditDate: new Date(`${input.creditDate}T00:00:00Z`) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedBy: user.id,
    },
  });
  await notifyMemberEvent({ db: deps.db }, { memberId: existing.memberId, type: "contribution_updated", recordId: id });
  return updated;
}

/** Soft-deletes a Contribution — its balance and Due effects vanish with it. */
export async function softDeleteContribution(deps: TxnDeps, id: string) {
  requireUser(deps.session);
  const existing = await deps.db.contribution.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, "Contribution not found");
  await deps.db.contribution.update({ where: { id }, data: { deletedAt: new Date() } });
  await notifyMemberEvent({ db: deps.db }, { memberId: existing.memberId, type: "contribution_deleted", recordId: id });
  return { ok: true };
}
