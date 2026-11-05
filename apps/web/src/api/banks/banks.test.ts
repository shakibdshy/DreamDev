import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { createBank, listBanks, purgeBank, softDeleteBank, updateBank } from "./service";

let db: Database;

function sessionFor(user: { id: string; role: string; status?: string }): Session {
  return {
    user: { id: user.id, role: user.role, status: user.status ?? "active" },
    session: { id: `sess-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  } as unknown as Session;
}

let admin: Session;
let editor: Session;

async function seedMember(): Promise<string> {
  const member = await db.member.create({
    data: { name: "Test Member", mobile: `01${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, joiningDate: new Date("2026-01-01") },
  });
  await db.shareAllotment.create({ data: { memberId: member.id, quantity: 1, effectiveMonth: "2026-01" } });
  return member.id;
}

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
});

describe("bank accounts", () => {
  test("requires an authenticated User; Editors and Admins both manage accounts", async () => {
    await expect(listBanks({ db, session: null }, {})).rejects.toMatchObject({ status: 401 });
    const created = await createBank({ db, session: editor }, { bankName: "DBBL", openingBalance: 25000 });
    expect(created.openingBalance).toBe(25000);
    const listed = await listBanks({ db, session: admin }, {});
    expect(listed.meta.total).toBe(1);
    expect(listed.data[0]?.bankName).toBe("DBBL");
  });

  test("Current Balance equals the Opening Balance while the ledger is empty", async () => {
    await createBank({ db, session: editor }, { bankName: "BRAC Bank", openingBalance: 10000 });
    const listed = await listBanks({ db, session: editor }, {});
    expect(listed.data[0]?.currentBalance).toBe(10000);
  });

  test("Current Balance folds all six entry types through the domain math", async () => {
    // Same worked example as the domain tests, but spread across two accounts:
    // Main: 10,000 + 5,000 − 20,000 + 5,000 − 500 − 3,000 (transfer out) = −3,500
    // Other: +3,000 (the receiving side of the Transfer)
    const main = await createBank({ db, session: editor }, { bankName: "Main", openingBalance: 10000 });
    const other = await createBank({ db, session: editor }, { bankName: "Other", openingBalance: 0 });
    const memberId = await seedMember();
    const day = new Date("2026-03-05");
    await db.contribution.create({ data: { memberId, bankAccountId: main.id, amount: 5000, creditDate: day, sharePriceAtEntry: 5000, shareQtyAtEntry: 1 } });
    const loan = await db.loan.create({ data: { memberId, bankAccountId: main.id, amount: 20000, date: day } });
    await db.loanRepayment.create({ data: { loanId: loan.id, memberId, bankAccountId: main.id, amount: 5000, creditDate: day } });
    await db.expense.create({ data: { bankAccountId: main.id, amount: 500, date: day, note: "bank charge" } });
    await db.transfer.create({ data: { fromAccountId: main.id, toAccountId: other.id, amount: 3000, date: day } });

    const listed = await listBanks({ db, session: editor }, { sort: "bankName", order: "asc" });
    const balances = Object.fromEntries(listed.data.map((b) => [b.bankName, b.currentBalance]));
    expect(balances["Main"]).toBe(-3500);
    expect(balances["Other"]).toBe(3000);
  });

  test("updates name, address and Opening Balance", async () => {
    const bank = await createBank({ db, session: editor }, { bankName: "City Bank" });
    const updated = await updateBank({ db, session: admin }, bank.id, { bankName: "City Bank PT", address: "Gulshan", openingBalance: 5000 });
    expect(updated.bankName).toBe("City Bank PT");
    expect(updated.address).toBe("Gulshan");
    const listed = await listBanks({ db, session: editor }, {});
    expect(listed.data[0]?.currentBalance).toBe(5000);
  });

  test("soft-delete hides the account; purge (Admin) removes it entirely when empty", async () => {
    const bank = await createBank({ db, session: editor }, { bankName: "Temp" });
    await softDeleteBank({ db, session: editor }, bank.id);
    expect((await listBanks({ db, session: editor }, {})).meta.total).toBe(0);

    await purgeBank({ db, session: admin }, bank.id);
    expect(await db.bankAccount.count()).toBe(0);
  });

  test("purge is Admin-only and refused while ledger entries reference the account", async () => {
    const bank = await createBank({ db, session: editor }, { bankName: "Has History" });
    const memberId = await seedMember();
    await db.contribution.create({
      data: { memberId, bankAccountId: bank.id, amount: 5000, creditDate: new Date("2026-03-05"), sharePriceAtEntry: 5000, shareQtyAtEntry: 1 },
    });

    await expect(purgeBank({ db, session: editor }, bank.id)).rejects.toMatchObject({ status: 403 });
    await expect(purgeBank({ db, session: admin }, bank.id)).rejects.toMatchObject({ status: 409 });
    // Soft-delete still works with history — that's the escape hatch
    await softDeleteBank({ db, session: editor }, bank.id);
    expect((await listBanks({ db, session: editor }, {})).meta.total).toBe(0);
  });

  test("unknown accounts are 404 and bad input is 422", async () => {
    await expect(updateBank({ db, session: editor }, "nope", { bankName: "X" })).rejects.toMatchObject({ status: 404 });
    await expect(createBank({ db, session: editor }, { bankName: "", openingBalance: -5 })).rejects.toMatchObject({ status: 422 });
  });
});
