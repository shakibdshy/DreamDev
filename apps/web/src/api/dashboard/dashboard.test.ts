import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { addMonths, monthOfDate } from "@DreamDev/db/domain/month";

import { sessionFor, thisDay } from "../test-support";
import { listBanks } from "../banks/service";
import { createMember } from "../members/service";
import { createContribution } from "../transactions/service";
import { createLoan, createRepayment } from "../loans/service";
import { createAdjustment } from "../ledger/adjustment";
import { createExpense } from "../ledger/expense";
import { listMembers } from "../members/service";
import { dashboard } from "./service";

let db: Database;
let admin: Session;

const thisMonth = monthOfDate(new Date());
const lastMonth = addMonths(thisMonth, -1);

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
});

beforeEach(async () => {
  await resetDb();
});

describe("dashboard", () => {
  test("empty ledger renders zeros, not errors", async () => {
    const data = await dashboard({ db, session: admin }, undefined);
    expect(data.kpis.activeMembers).toBe(0);
    expect(data.kpis.totalShares).toBe(0);
    expect(data.kpis.totalDueOutstanding).toBe(0);
    expect(data.kpis.loansOutstanding).toBe(0);
    expect(data.monthlySeries).toHaveLength(12);
    expect(data.monthlySeries.every((m) => m.collected === 0)).toBe(true);
    expect(data.grid).toEqual([]);
    expect(data.topDues).toEqual([]);
    expect(data.recent).toEqual([]);
    expect(data.loansPerMember).toEqual([]);
  });

  test("KPIs match their source pages and manual math", async () => {
    const bank = await db.bankAccount.create({ data: { bankName: "DBBL", openingBalance: 100000 } });
    const rahim = await createMember({ db, session: admin }, { name: "Rahim", mobile: "01711111111", joiningDate: `${lastMonth}-01`, shareQuantity: 2 });
    const karim = await createMember({ db, session: admin }, { name: "Karim", mobile: "01822222222", joiningDate: `${lastMonth}-01`, shareQuantity: 1 });

    // Rahim: paid last month fully, this month partial (10k of 10k + 5k of 5k… see amounts below)
    await createContribution({ db, session: admin }, { memberId: rahim.id, bankAccountId: bank.id, amount: 10000, creditDate: `${lastMonth}-10` });
    await createContribution({ db, session: admin }, { memberId: rahim.id, bankAccountId: bank.id, amount: 8000, creditDate: thisDay(thisMonth, 10) });
    await createContribution({ db, session: admin }, { memberId: karim.id, bankAccountId: bank.id, amount: 6000, creditDate: thisDay(thisMonth, 12) });

    // Karim took a 20,000 loan and repaid 5,000
    const loan = (await createLoan({ db, session: admin }, { memberId: karim.id, bankAccountId: bank.id, amount: 20000, date: thisDay(thisMonth, 5) })).loan;
    await createRepayment({ db, session: admin }, loan.id, { bankAccountId: bank.id, amount: 5000, creditDate: thisDay(thisMonth, 15) });

    await createExpense({ db, session: admin }, { bankAccountId: bank.id, amount: 500, date: thisDay(thisMonth, 20), note: "charge" });

    const data = await dashboard({ db, session: admin }, undefined);

    // Members & shares
    expect(data.kpis.activeMembers).toBe(2);
    expect(data.kpis.totalShares).toBe(3);

    // This month: billed 3 shares × 5000 = 15000; collected 8000 + 6000 = 14000
    expect(data.kpis.thisMonthBilled).toBe(15000);
    expect(data.kpis.thisMonthCollected).toBe(14000);

    // Due totals must equal the members list's own math (source-of-truth parity)
    const memberList = await listMembers({ db, session: admin }, { pageSize: 100 });
    const listDue = memberList.data.reduce((sum, m) => sum + Math.max(0, m.due), 0);
    expect(data.kpis.totalDueOutstanding).toBe(listDue);
    // Manual: Rahim billed 2×5000×2 months = 20000, paid 18000 → due 2000; Karim billed 5000×2 = 10000, paid 6000 → due 4000
    expect(data.kpis.totalDueOutstanding).toBe(6000);

    // Loans: 20000 − 5000 = 15000 outstanding, attributed to Karim
    expect(data.kpis.loansOutstanding).toBe(15000);
    expect(data.loansPerMember).toEqual([{ memberId: karim.id, name: "Karim", outstanding: 15000 }]);

    // Bank balances match the banks page
    const banksPage = await listBanks({ db, session: admin }, {});
    expect(data.kpis.bankBalances[0]?.currentBalance).toBe(banksPage.data[0]?.currentBalance);

    // 12-month series: lastMonth 10000, thisMonth 14000
    const series = Object.fromEntries(data.monthlySeries.map((m) => [m.month, m.collected]));
    expect(series[lastMonth]).toBe(10000);
    expect(series[thisMonth]).toBe(14000);

    // Top dues: Karim (4000) before Rahim (2000)
    expect(data.topDues.map((t) => t.name)).toEqual(["Karim", "Rahim"]);

    // Grid: this month's cells — Rahim partial, Karim partial
    const rahimRow = data.grid.find((g) => g.name === "Rahim");
    const rahimThisMonth = rahimRow?.cells.find((c) => c.month === thisMonth);
    expect(rahimThisMonth?.status).toBe("partial");
    const karimThisMonth = data.grid.find((g) => g.name === "Karim")?.cells.find((c) => c.month === thisMonth);
    // True FIFO: Karim's ৳6,000 retires last month's ৳5,000 hole first, then ৳1,000 toward this month — partial, not ahead
    expect(karimThisMonth?.status).toBe("partial");

    // Recent: loan, expense, repayments and contributions all present with type labels
    expect(data.recent.length).toBe(5);
    expect(data.recent.map((r) => r.type)).toContain("loan");
    expect(data.recent.map((r) => r.type)).toContain("expense");
  });

  test("an Adjustment moves grid and KPIs together", async () => {
    const member = await createMember({ db, session: admin }, { name: "Sole", mobile: "01799999999", joiningDate: `${thisMonth}-01`, shareQuantity: 1 });
    await createAdjustment({ db, session: admin }, { memberId: member.id, amount: -5000, reason: "waived first month", month: thisMonth });

    const data = await dashboard({ db, session: admin }, undefined);
    expect(data.kpis.totalDueOutstanding).toBe(0); // waived
    expect(data.kpis.thisMonthBilled).toBe(0); // the waiver cancels this month's bill in the projection
    const cell = data.grid[0]?.cells.find((c) => c.month === thisMonth);
    expect(cell?.bill).toBe(0);
  });

  test("requires authentication", async () => {
    await expect(dashboard({ db, session: null }, undefined)).rejects.toMatchObject({ status: 401 });
  });
});
