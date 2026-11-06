import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { monthOfDate } from "@DreamDev/db/domain/month";

import { sessionFor } from "../test-support";
import { listBanks } from "../banks/service";
import { createMember } from "../members/service";
import { createContribution, listFeed, memberPosition, softDeleteContribution, updateContribution } from "./service";

let db: Database;
let editor: Session;

const thisMonth = monthOfDate(new Date());

let memberId: string;
let bankId: string;
let bankId2: string;

beforeAll(async () => {
  db = await setupTestDb();
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
  const member = await createMember(
    { db, session: editor },
    { name: "Rahim", mobile: "01712345678", joiningDate: `${thisMonth}-01`, shareQuantity: 1 },
  );
  memberId = member.id;
  bankId = (await db.bankAccount.create({ data: { bankName: "DBBL", openingBalance: 10000 } })).id;
  bankId2 = (await db.bankAccount.create({ data: { bankName: "BRAC", openingBalance: 0 } })).id;
});

describe("contributions", () => {
  test("creates with the Share Price and quantity snapshot at entry", async () => {
    const created = await createContribution(
      { db, session: editor },
      { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-10` },
    );
    expect(created.sharePriceAtEntry).toBe(5000);
    expect(created.shareQtyAtEntry).toBe(1);

    const banks = await listBanks({ db, session: editor }, {});
    expect(banks.data.find((b) => b.id === bankId)?.currentBalance).toBe(15000);
  });

  test("memberPosition exposes Due for the form's disabled field; overpay shows Advance", async () => {
    const before = await memberPosition({ db, session: editor }, memberId);
    expect(before.due).toBe(5000);

    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 6000, creditDate: `${thisMonth}-10` });
    const after = await memberPosition({ db, session: editor }, memberId);
    expect(after.due).toBe(-1000);
    expect(after.advance).toBe(1000);
  });

  test("edit updates the amount with audit; soft-delete removes the entry and its effects", async () => {
    const created = await createContribution(
      { db, session: editor },
      { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-10` },
    );

    const updated = await updateContribution({ db, session: editor }, created.id, { amount: 6500 });
    expect(updated.amount).toBe(6500);
    expect(updated.updatedBy).toBe("editor-1");

    await softDeleteContribution({ db, session: editor }, created.id);
    const banks = await listBanks({ db, session: editor }, {});
    expect(banks.data.find((b) => b.id === bankId)?.currentBalance).toBe(10000); // back to opening
    expect((await listFeed({ db, session: editor }, {})).meta.total).toBe(0);
    expect((await memberPosition({ db, session: editor }, memberId)).due).toBe(5000);
  });

  test("validates member, bank, amount and auth", async () => {
    await expect(
      createContribution({ db, session: null }, { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-10` }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      createContribution({ db, session: editor }, { memberId: "nope", bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-10` }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 0, creditDate: `${thisMonth}-10` }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("unified Transactions feed", () => {
  test("merges entry types chronologically with signed amounts and names", async () => {
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-02` });
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId2, amount: 3000, creditDate: `${thisMonth}-01` });
    await db.expense.create({ data: { bankAccountId: bankId, amount: 500, date: new Date(`${thisMonth}-03T00:00:00Z`), note: "charge" } });
    await db.transfer.create({
      data: { fromAccountId: bankId, toAccountId: bankId2, amount: 2000, date: new Date(`${thisMonth}-04T00:00:00Z`) },
    });

    const feed = await listFeed({ db, session: editor }, { order: "asc" });
    expect(feed.meta.total).toBe(4);
    expect(feed.data.map((e) => [e.date.slice(-2), e.type])).toEqual([
      ["01", "contribution"],
      ["02", "contribution"],
      ["03", "expense"],
      ["04", "transfer"],
    ]);
    expect(feed.data[1]?.memberName).toBe("Rahim");
    expect(feed.data[2]?.amount).toBe(-500); // money out is negative
    expect(feed.data[3]?.bankName).toBe("DBBL");
    expect(feed.data[3]?.toBankName).toBe("BRAC");
  });

  test("filters by type, member, bank and date range; paginates", async () => {
    const a = await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-01` });
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId2, amount: 3000, creditDate: `${thisMonth}-05` });
    await db.expense.create({ data: { bankAccountId: bankId, amount: 500, date: new Date(`${thisMonth}-10T00:00:00Z`) } });

    expect((await listFeed({ db, session: editor }, { type: "contribution" })).meta.total).toBe(2);
    expect((await listFeed({ db, session: editor }, { type: "expense" })).meta.total).toBe(1);
    expect((await listFeed({ db, session: editor }, { memberId })).meta.total).toBe(2);
    expect((await listFeed({ db, session: editor }, { bankAccountId: bankId })).meta.total).toBe(2); // contribution a + expense
    expect((await listFeed({ db, session: editor }, { from: `${thisMonth}-04` })).meta.total).toBe(2);
    expect((await listFeed({ db, session: editor }, { to: `${thisMonth}-04` })).meta.total).toBe(1); // only the 01st

    const page = await listFeed({ db, session: editor }, { page: 1, pageSize: 2, order: "asc" });
    expect(page.data).toHaveLength(2);
    expect(page.data[0]?.id).toBe(a.id);
    expect(page.meta.total).toBe(3);
  });

  test("requires authentication", async () => {
    await expect(listFeed({ db, session: null }, {})).rejects.toMatchObject({ status: 401 });
  });
});
