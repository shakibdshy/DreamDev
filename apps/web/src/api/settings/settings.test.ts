import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { addMonths, monthOfDate } from "@DreamDev/db/domain/month";

import { sessionFor } from "../test-support";
import { createMember, listMembers } from "../members/service";
import { createContribution } from "../transactions/service";
import { getSharePrice, updateSharePrice } from "./service";

let db: Database;
let admin: Session;
let editor: Session;

const thisMonth = monthOfDate(new Date());
const lastMonth = addMonths(thisMonth, -1);

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
});

describe("settings (Share Price)", () => {
  test("defaults to ৳5,000; Editor read OK but write is 403", async () => {
    const price = await getSharePrice({ db, session: editor });
    expect(price.sharePrice).toBe(5000);
    await expect(updateSharePrice({ db, session: editor }, { sharePrice: 6000 })).rejects.toMatchObject({ status: 403 });
    await expect(updateSharePrice({ db, session: null }, { sharePrice: 6000 })).rejects.toMatchObject({ status: 401 });
  });

  test("validated as positive integer taka", async () => {
    await expect(updateSharePrice({ db, session: admin }, { sharePrice: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(updateSharePrice({ db, session: admin }, { sharePrice: 500.5 })).rejects.toMatchObject({ status: 422 });
  });

  test("a change leaves past months and snapshots untouched; new entries use the new price", async () => {
    const bank = await db.bankAccount.create({ data: { bankName: "DBBL" } });
    const member = await createMember(
      { db, session: admin },
      { name: "Rahim", mobile: "01711111111", joiningDate: `${lastMonth}-01`, shareQuantity: 1 },
    );

    const oldContribution = await createContribution(
      { db, session: admin },
      { memberId: member.id, bankAccountId: bank.id, amount: 5000, creditDate: `${lastMonth}-10` },
    );

    const dueBefore = (await listMembers({ db, session: admin }, {})).data[0]?.due;

    const updated = await updateSharePrice({ db, session: admin }, { sharePrice: 6000 });
    expect(updated.changed).toBe(true);
    expect(updated.sharePrice).toBe(6000);
    expect(updated.effectiveMonth).toBe(thisMonth);

    // The old Contribution's snapshot is untouched
    const snapshot = await db.contribution.findUnique({ where: { id: oldContribution.id } });
    expect(snapshot?.sharePriceAtEntry).toBe(5000);

    // Past month still billed at 5000; this month's bill moves 5000 → 6000, so Due grows by exactly 1000
    const dueAfter = (await listMembers({ db, session: admin }, {})).data[0]?.due;
    expect(dueAfter! - dueBefore!).toBe(1000);

    // New Contributions snapshot the new price
    const newContribution = await createContribution(
      { db, session: admin },
      { memberId: member.id, bankAccountId: bank.id, amount: 6000, creditDate: `${thisMonth}-10` },
    );
    expect(newContribution.sharePriceAtEntry).toBe(6000);

    // Setting the same price again is a no-op
    const again = await updateSharePrice({ db, session: admin }, { sharePrice: 6000 });
    expect(again.changed).toBe(false);
  });
});
