import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

import { HttpError, parseOr422, requireUser } from "../http";
import { createLoanBodySchema, createRepaymentBodySchema, SOFT_CAP_MULTIPLIER } from "./schema";

export interface LoansDeps {
  db: Database;
  session: Session | null;
}

export interface LoanView {
  id: string;
  amount: number;
  date: string;
  note: string | null;
  repaid: number;
  outstanding: number;
  settled: boolean;
  repayments: { id: string; amount: number; creditDate: string }[];
}

/** Loans are interest-free (GLOSSARY.md); outstanding = principal − live repayments. */
async function loanViews(db: Database, memberId: string): Promise<{ loans: LoanView[]; totalOutstanding: number }> {
  const [loans, repayments] = await Promise.all([
    db.loan.findMany({ where: { memberId, deletedAt: null }, orderBy: { date: "asc" } }),
    db.loanRepayment.findMany({ where: { memberId, deletedAt: null }, orderBy: { creditDate: "asc" } }),
  ]);

  const views = loans.map((loan) => {
    const own = repayments.filter((r) => r.loanId === loan.id);
    const repaid = own.reduce((sum, r) => sum + r.amount, 0);
    const outstanding = Math.max(0, loan.amount - repaid);
    return {
      id: loan.id,
      amount: loan.amount,
      date: loan.date.toISOString().slice(0, 10),
      note: loan.note,
      repaid,
      outstanding,
      settled: outstanding === 0,
      repayments: own.map((r) => ({ id: r.id, amount: r.amount, creditDate: r.creditDate.toISOString().slice(0, 10) })),
    };
  });
  return { loans: views, totalOutstanding: views.reduce((sum, l) => sum + l.outstanding, 0) };
}

/** A Member's Loans with per-loan outstanding and the total across concurrent Loans. */
export async function memberLoans(deps: LoansDeps, memberId: string) {
  requireUser(deps.session);
  const member = await deps.db.member.findUnique({ where: { id: memberId } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");
  return loanViews(deps.db, memberId);
}

/** Creates a Loan from the fund; warns (never blocks) past 2× total contributions. */
export async function createLoan(deps: LoansDeps, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createLoanBodySchema, body);

  const [member, bank, contributedAgg] = await Promise.all([
    deps.db.member.findUnique({ where: { id: input.memberId } }),
    deps.db.bankAccount.findFirst({ where: { id: input.bankAccountId, deletedAt: null } }),
    deps.db.contribution.aggregate({ _sum: { amount: true }, where: { memberId: input.memberId, deletedAt: null } }),
  ]);
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");
  if (!bank) throw new HttpError(404, "Bank Account not found");

  const contributed = contributedAgg._sum.amount ?? 0;
  const warning =
    input.amount > SOFT_CAP_MULTIPLIER * contributed
      ? `Loan of ৳${input.amount.toLocaleString()} exceeds twice ${member.name}'s total contributions (৳${contributed.toLocaleString()}) — recorded anyway`
      : null;

  const loan = await deps.db.loan.create({
    data: {
      memberId: input.memberId,
      bankAccountId: input.bankAccountId,
      amount: input.amount,
      date: new Date(`${input.date}T00:00:00Z`),
      note: input.note,
      createdBy: user.id,
    },
  });
  return { loan, warning };
}

/** Records a Loan Repayment — capped at the Loan's outstanding; excess must be a Contribution. */
export async function createRepayment(deps: LoansDeps, loanId: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createRepaymentBodySchema, body);

  const [loan, bank] = await Promise.all([
    deps.db.loan.findUnique({ where: { id: loanId } }),
    deps.db.bankAccount.findFirst({ where: { id: input.bankAccountId, deletedAt: null } }),
  ]);
  if (!loan || loan.deletedAt) throw new HttpError(404, "Loan not found");
  if (!bank) throw new HttpError(404, "Bank Account not found");

  const repaid = await deps.db.loanRepayment.aggregate({
    _sum: { amount: true },
    where: { loanId, deletedAt: null },
  });
  const outstanding = loan.amount - (repaid._sum.amount ?? 0);
  if (input.amount > outstanding) {
    throw new HttpError(
      422,
      `Repayment exceeds the ৳${outstanding.toLocaleString()} outstanding — record the ৳${(input.amount - outstanding).toLocaleString()} excess as a Contribution instead`,
    );
  }

  const repayment = await deps.db.loanRepayment.create({
    data: {
      loanId,
      memberId: loan.memberId,
      bankAccountId: input.bankAccountId,
      amount: input.amount,
      creditDate: new Date(`${input.creditDate}T00:00:00Z`),
      createdBy: user.id,
    },
  });
  const settled = outstanding - input.amount === 0;
  return { repayment, settled, outstandingAfter: outstanding - input.amount };
}

/** Soft-deletes a Loan and its repayments — balances and outstanding recover. */
export async function softDeleteLoan(deps: LoansDeps, loanId: string) {
  requireUser(deps.session);
  const loan = await deps.db.loan.findUnique({ where: { id: loanId } });
  if (!loan || loan.deletedAt) throw new HttpError(404, "Loan not found");
  const now = new Date();
  await deps.db.$transaction([
    deps.db.loan.update({ where: { id: loanId }, data: { deletedAt: now } }),
    deps.db.loanRepayment.updateMany({ where: { loanId }, data: { deletedAt: now } }),
  ]);
  return { ok: true };
}
