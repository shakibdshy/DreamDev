import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { monthOfDate } from "@DreamDev/db/domain/month";

import { sessionFor } from "../test-support";
import { listBanks } from "../banks/service";
import { createMember } from "../members/service";
import { listFeed, memberPosition } from "../transactions/service";
import { createAdjustment, softDeleteAdjustment } from "./adjustment";
import { createExpense, softDeleteExpense, updateExpense } from "./expense";
import { createTransfer, softDeleteTransfer } from "./transfer";

let db: Database;
let admin: Session;
let editor: Session;
const thisMonth = monthOfDate(new Date());

let memberId: string;
let bankA: string;
let bankB: string;

async function balances(): Promise<Record<string, number>> {
  const banks = await listBanks({ db, session: editor }, {});
  return Object.fromEntries(banks.data.map((b) => [b.bankName, b.currentBalance]));
}

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
  memberId = (await createMember({ db, session: editor }, { name: "Rahim", mobile: "01712345678", joiningDate: `${thisMonth}-01`, shareQuantity: 1 })).id;
  bankA = (await db.bankAccount.create({ data: { bankName: "A", openingBalance: 20000 } })).id;
  bankB = (await db.bankAccount.create({ data: { bankName: "B", openingBalance: 5000 } })).id;
});

describe("expenses", () => {
  test("reduces the balance, appears in the feed, edits and soft-deletes cleanly", async () => {
    const expense = await createExpense({ db, session: editor }, { bankAccountId: bankA, amount: 500, date: `${thisMonth}-10`, note: "bank charge" });
    expect((await balances())["A"]).toBe(19500);
    expect((await listFeed({ db, session: editor }, { type: "expense" })).data[0]?.amount).toBe(-500);

    await updateExpense({ db, session: editor }, expense.id, { amount: 800 });
    expect((await balances())["A"]).toBe(19200);

    await softDeleteExpense({ db, session: editor }, expense.id);
    expect((await balances())["A"]).toBe(20000);
    expect((await listFeed({ db, session: editor }, { type: "expense" })).meta.total).toBe(0);
  });
});

describe("transfers", () => {
  test("moves money between the team's own accounts — total holdings unchanged", async () => {
    await createTransfer({ db, session: editor }, { fromAccountId: bankA, toAccountId: bankB, amount: 3000, date: `${thisMonth}-10` });
    const after = await balances();
    expect(after["A"]).toBe(17000);
    expect(after["B"]).toBe(8000);

    const feed = await listFeed({ db, session: editor }, { type: "transfer" });
    expect(feed.data[0]?.bankName).toBe("A");
    expect(feed.data[0]?.toBankName).toBe("B");
    expect(feed.data[0]?.amount).toBe(-3000);
  });

  test("requires two different accounts", async () => {
    await expect(
      createTransfer({ db, session: editor }, { fromAccountId: bankA, toAccountId: bankA, amount: 1000, date: `${thisMonth}-10` }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("soft-delete restores both sides", async () => {
    const transfer = await createTransfer({ db, session: editor }, { fromAccountId: bankA, toAccountId: bankB, amount: 3000, date: `${thisMonth}-10` });
    await softDeleteTransfer({ db, session: editor }, transfer.id);
    const after = await balances();
    expect(after["A"]).toBe(20000);
    expect(after["B"]).toBe(5000);
  });
});

describe("adjustments", () => {
  test("Admin-only; positive raises Due, negative reduces it into an Advance", async () => {
    await expect(
      createAdjustment({ db, session: editor }, { memberId, amount: 3000, reason: "opening due" }),
    ).rejects.toMatchObject({ status: 403 });

    await createAdjustment({ db, session: admin }, { memberId, amount: 3000, reason: "opening due from before the app" });
    expect((await memberPosition({ db, session: editor }, memberId)).due).toBe(8000); // 5000 billed + 3000

    await createAdjustment({ db, session: admin }, { memberId, amount: -10000, reason: "waived while abroad", month: thisMonth });
    const position = await memberPosition({ db, session: editor }, memberId);
    expect(position.due).toBe(-2000);
    expect(position.advance).toBe(2000);
  });

  test("carries its month label into the feed and soft-deletes cleanly", async () => {
    await createAdjustment({ db, session: admin }, { memberId, amount: 3000, reason: "opening due", month: "2025-12" });
    const feed = await listFeed({ db, session: editor }, { type: "adjustment" });
    expect(feed.data[0]?.date).toBe("2025-12-15");
    expect(feed.data[0]?.note).toBe("opening due");

    await softDeleteAdjustment({ db, session: admin }, feed.data[0]!.id);
    expect((await memberPosition({ db, session: editor }, memberId)).due).toBe(5000);
  });

  test("requires a reason and a non-zero amount", async () => {
    await expect(createAdjustment({ db, session: admin }, { memberId, amount: 0, reason: "x" })).rejects.toMatchObject({ status: 422 });
    await expect(createAdjustment({ db, session: admin }, { memberId, amount: 500, reason: "" })).rejects.toMatchObject({ status: 422 });
  });
});
