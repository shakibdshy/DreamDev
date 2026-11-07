import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { todayInDhaka } from "@DreamDev/db/domain/month";

import { futureDay, pastMonth, sessionFor } from "../test-support";
import { listBanks } from "../banks/service";
import { createMember } from "../members/service";
import { createContribution, listFeed } from "../transactions/service";
import { createLoan, createRepayment, memberLoans, softDeleteLoan, softDeleteRepayment } from "./service";

let db: Database;
let editor: Session;
const thisMonth = pastMonth();

let memberId: string;
let bankId: string;

async function balance(): Promise<number> {
  const banks = await listBanks({ db, session: editor }, {});
  return banks.data[0]?.currentBalance ?? 0;
}

beforeAll(async () => {
  db = await setupTestDb();
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
  memberId = (await createMember({ db, session: editor }, { name: "Karim", mobile: "01712345678", joiningDate: `${thisMonth}-01`, shareQuantity: 1 })).id;
  bankId = (await db.bankAccount.create({ data: { bankName: "DBBL", openingBalance: 50000 } })).id;
});

describe("loans", () => {
  test("disbursement reduces the Current Balance; soft warning past 2× contributions", async () => {
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-05` });

    const small = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 8000, date: `${thisMonth}-10` });
    expect(small.warning).toBeNull();
    expect(await balance()).toBe(50000 + 5000 - 8000);

    const big = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 20000, date: `${thisMonth}-11` });
    expect(big.warning).toContain("exceeds twice");
    expect(big.loan.amount).toBe(20000); // warning, not a block
  });

  test("outstanding = principal − repaid; settles automatically at zero", async () => {
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-10` });

    let view = await memberLoans({ db, session: editor }, memberId);
    expect(view.loans[0]?.outstanding).toBe(10000);
    expect(view.loans[0]?.settled).toBe(false);
    expect(view.totalOutstanding).toBe(10000);

    const first = await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 4000, creditDate: `${thisMonth}-15` });
    expect(first.settled).toBe(false);
    expect(first.outstandingAfter).toBe(6000);

    const last = await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 6000, creditDate: `${thisMonth}-20` });
    expect(last.settled).toBe(true);

    view = await memberLoans({ db, session: editor }, memberId);
    expect(view.loans[0]?.settled).toBe(true);
    expect(view.totalOutstanding).toBe(0);
  });

  test("history includes every repayment in date order, its bank and the cleared loan", async () => {
    const otherBank = await db.bankAccount.create({ data: { bankName: "BRAC", openingBalance: 0 } });
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-01` });
    const later = await createRepayment({ db, session: editor }, loan.id, { bankAccountId: otherBank.id, amount: 6000, creditDate: `${thisMonth}-20` });
    const earlier = await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 4000, creditDate: `${thisMonth}-10` });
    const view = await memberLoans({ db, session: editor }, memberId);
    expect(view.loans[0]).toMatchObject({ bankName: "DBBL", amount: 10000, repaid: 10000, outstanding: 0, settled: true });
    expect(view.loans[0]?.repayments).toEqual([
      { id: earlier.repayment.id, amount: 4000, creditDate: `${thisMonth}-10`, bankName: "DBBL" },
      { id: later.repayment.id, amount: 6000, creditDate: `${thisMonth}-20`, bankName: "BRAC" },
    ]);
  });

  test("repayment is capped at outstanding with Contribution guidance", async () => {
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, date: `${thisMonth}-10` });
    await expect(
      createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 6000, creditDate: `${thisMonth}-15` }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("repayment returns money to the account; concurrent loans total", async () => {
    const a = (await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-01` })).loan;
    await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, date: `${thisMonth}-02` });
    expect(await balance()).toBe(50000 - 15000);

    await createRepayment({ db, session: editor }, a.id, { bankAccountId: bankId, amount: 3000, creditDate: `${thisMonth}-15` });
    expect(await balance()).toBe(38000);

    const view = await memberLoans({ db, session: editor }, memberId);
    expect(view.loans).toHaveLength(2);
    expect(view.totalOutstanding).toBe(12000);
  });

  test("loans and repayments appear in the unified feed with correct labels and signs", async () => {
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-10`, note: "emergency" });
    await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 4000, creditDate: `${thisMonth}-15` });

    const feed = await listFeed({ db, session: editor }, { type: "loan", order: "asc" });
    expect(feed.data[0]?.amount).toBe(-10000);
    const repayments = await listFeed({ db, session: editor }, { type: "loan_repayment", order: "asc" });
    expect(repayments.data[0]?.amount).toBe(4000);
    expect(repayments.data[0]?.memberName).toBe("Karim");
  });

  test("soft-deleting a Loan removes it, its repayments, and their balance effects", async () => {
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-10` });
    await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 4000, creditDate: `${thisMonth}-15` });

    await softDeleteLoan({ db, session: editor }, loan.id);
    expect(await balance()).toBe(50000);
    expect((await memberLoans({ db, session: editor }, memberId)).totalOutstanding).toBe(0);
    expect((await listFeed({ db, session: editor }, {})).meta.total).toBe(0);
  });

  test("softDeleteRepayment removes one repayment; outstanding recovers, loan untouched", async () => {
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-01` });
    const first = await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 4000, creditDate: `${thisMonth}-02` });
    await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 3000, creditDate: `${thisMonth}-03` });

    await softDeleteRepayment({ db, session: editor }, first.repayment.id);

    const view = await memberLoans({ db, session: editor }, memberId);
    expect(view.loans[0]?.repaid).toBe(3000);
    expect(view.loans[0]?.outstanding).toBe(7000);
    expect(view.loans[0]?.settled).toBe(false);
    expect(await db.loan.count({ where: { deletedAt: null } })).toBe(1); // loan untouched
    await expect(softDeleteRepayment({ db, session: editor }, first.repayment.id)).rejects.toMatchObject({ status: 404 });
  });

  test("a loan never exceeds the account's available balance", async () => {
    await expect(
      createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 60000, date: `${thisMonth}-10` }),
    ).rejects.toMatchObject({ status: 422 });

    // Exactly the available balance is allowed
    const exact = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 50000, date: `${thisMonth}-10` });
    expect(exact.loan.amount).toBe(50000);
    expect(exact.warning).toContain("exceeds twice");
  });

  test("requires authentication and live member/bank", async () => {
    await expect(createLoan({ db, session: null }, { memberId, bankAccountId: bankId, amount: 100, date: `${thisMonth}-10` })).rejects.toMatchObject({ status: 401 });
    await expect(
      createLoan({ db, session: editor }, { memberId: "nope", bankAccountId: bankId, amount: 100, date: `${thisMonth}-10` }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("record dates can't be in the future (Asia/Dhaka)", async () => {
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-05` });
    const tomorrow = futureDay();
    await expect(
      createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 8000, date: tomorrow }),
    ).rejects.toMatchObject({ status: 422 });

    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 8000, date: todayInDhaka() });
    await expect(
      createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 1000, creditDate: tomorrow }),
    ).rejects.toMatchObject({ status: 422 });
    await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 1000, creditDate: todayInDhaka() }); // today is fine
  });
});
