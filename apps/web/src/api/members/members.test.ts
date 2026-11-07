import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";
import { addMonths, monthOfDate, todayInDhaka } from "@DreamDev/db/domain/month";

import { futureDay, sessionFor, thisDay } from "../test-support";
import { changeShares, createMember, getMember, listMembers, purgeMember, setStatus, softDeleteMember, updateMember } from "./service";

let db: Database;
let admin: Session;
let editor: Session;

const thisMonth = monthOfDate(new Date());
const nextMonth = addMonths(thisMonth, 1);

function memberBody(overrides: Record<string, unknown> = {}) {
  return { name: "Rahim", mobile: "01712345678", joiningDate: `${thisMonth}-01`, shareQuantity: 3, ...overrides };
}

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
  editor = sessionFor({ id: "editor-1", role: "editor" });
});

beforeEach(async () => {
  await resetDb();
});

describe("members", () => {
  test("creates a Member with their first Share Allotment fixed at joining", async () => {
    const created = await createMember({ db, session: editor }, memberBody());
    expect(created.mobile).toBe("01712345678");
    const allotments = await db.shareAllotment.findMany({ where: { memberId: created.id } });
    expect(allotments).toHaveLength(1);
    expect(allotments[0]?.quantity).toBe(3);
    expect(allotments[0]?.effectiveMonth).toBe(thisMonth);
  });

  test("rejects bad mobile format (422) and duplicates (409)", async () => {
    await expect(createMember({ db, session: editor }, memberBody({ mobile: "12345" }))).rejects.toMatchObject({ status: 422 });
    await createMember({ db, session: editor }, memberBody());
    await expect(createMember({ db, session: editor }, memberBody({ name: "Other" }))).rejects.toMatchObject({ status: 409 });
  });

  test("list computes Due from billing: 3 shares joined this month, nothing paid → Due ৳15,000", async () => {
    await createMember({ db, session: editor }, memberBody());
    const listed = await listMembers({ db, session: editor }, {});
    expect(listed.meta.total).toBe(1);
    expect(listed.data[0]?.shares).toBe(3);
    expect(listed.data[0]?.due).toBe(15000);
    expect(listed.data[0]?.advance).toBe(0);
  });

  test("list search by name or mobile, server-paginated", async () => {
    await createMember({ db, session: editor }, memberBody({ name: "Karim", mobile: "01711111111" }));
    await createMember({ db, session: editor }, memberBody({ name: "Rahim", mobile: "01822222222" }));
    const karimOnly = await listMembers({ db, session: editor }, { search: "karim" });
    expect(karimOnly.meta.total).toBe(1);
    expect(karimOnly.data[0]?.name).toBe("Karim");
    const byMobile = await listMembers({ db, session: editor }, { search: "0182" });
    expect(byMobile.data[0]?.name).toBe("Rahim");
    const page = await listMembers({ db, session: editor }, { page: 1, pageSize: 1, sort: "name", order: "asc" });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.name).toBe("Karim");
    expect(page.meta.total).toBe(2);
  });

  test("overpayment shows as Advance: 1 share, pays ৳6,000 → Advance ৳1,000", async () => {
    const member = await createMember({ db, session: editor }, memberBody({ shareQuantity: 1 }));
    await db.contribution.create({
      data: {
        memberId: member.id,
        bankAccountId: (await db.bankAccount.create({ data: { bankName: "T" } })).id,
        amount: 6000,
        creditDate: new Date(),
        sharePriceAtEntry: 5000,
        shareQtyAtEntry: 1,
      },
    });
    const listed = await listMembers({ db, session: editor }, {});
    expect(listed.data[0]?.due).toBe(-1000);
    expect(listed.data[0]?.advance).toBe(1000);
  });

  test("Share change: Editor forbidden (403); Admin appends forward-effective; backdating refused", async () => {
    const member = await createMember({ db, session: editor }, memberBody({ shareQuantity: 1 }));
    await expect(changeShares({ db, session: editor }, member.id, { quantity: 2 })).rejects.toMatchObject({ status: 403 });
    await expect(changeShares({ db, session: admin }, member.id, { quantity: 2, effectiveMonth: addMonths(thisMonth, -1) })).rejects.toMatchObject({ status: 422 });

    const change = await changeShares({ db, session: admin }, member.id, { quantity: 2, effectiveMonth: nextMonth });
    expect(change.quantity).toBe(2);
    // This month still bills 1 share; the change is forward-effective only
    const listed = await listMembers({ db, session: editor }, {});
    expect(listed.data[0]?.due).toBe(5000);
    expect(listed.data[0]?.shares).toBe(2); // current quantity shown
  });

  test("Inactive pauses Billing for whole months; reactivation resumes; Exit stops it inclusive", async () => {
    const lastMonth = addMonths(thisMonth, -1);
    const member = await createMember({ db, session: editor }, memberBody({ shareQuantity: 1, joiningDate: `${lastMonth}-01` }));

    // Inactive for all of last month → that month is never billed
    await setStatus({ db, session: editor }, member.id, { status: "inactive", date: `${lastMonth}-01` });
    await setStatus({ db, session: editor }, member.id, { status: "active", date: `${lastMonth}-20` });
    expect((await listMembers({ db, session: editor }, {})).data[0]?.due).toBe(5000); // this month only

    // Exit this month: billing stops at this month (inclusive); future never bills
    const exited = await setStatus({ db, session: admin }, member.id, { status: "exited", date: thisDay(thisMonth, 15) });
    expect(exited.status).toBe("exited");
    expect(exited.exitDate).toBeTruthy();
    expect((await listMembers({ db, session: editor }, {})).data[0]?.due).toBe(5000);
  });

  test("detail returns the billing timeline for a chosen year", async () => {
    const member = await createMember({ db, session: editor }, memberBody({ shareQuantity: 1 }));
    const detail = await getMember({ db, session: editor }, member.id, new Date().getFullYear());
    expect(detail.timeline.length).toBeGreaterThan(0);
    expect(detail.summary.due).toBe(5000);
    const thisMonthCell = detail.timeline.find((cell) => cell.month === thisMonth);
    expect(thisMonthCell?.status).toBe("due");
    expect(thisMonthCell?.bill).toBe(5000);
  });

  test("updates Editor-editable fields; duplicate mobile on update is 409", async () => {
    const a = await createMember({ db, session: editor }, memberBody({ mobile: "01711111111" }));
    const b = await createMember({ db, session: editor }, memberBody({ name: "B", mobile: "01822222222" }));
    const updated = await updateMember({ db, session: editor }, b.id, { name: "B2", address: "Dhaka" });
    expect(updated.name).toBe("B2");
    await expect(updateMember({ db, session: editor }, b.id, { mobile: "01711111111" })).rejects.toMatchObject({ status: 409 });
    expect((await db.member.findUnique({ where: { id: a.id } }))?.mobile).toBe("01711111111");
  });

  test("soft-delete hides; purge is Admin-only and refused with ledger history", async () => {
    const member = await createMember({ db, session: editor }, memberBody());
    await db.contribution.create({
      data: {
        memberId: member.id,
        bankAccountId: (await db.bankAccount.create({ data: { bankName: "T" } })).id,
        amount: 5000,
        creditDate: new Date(),
        sharePriceAtEntry: 5000,
        shareQtyAtEntry: 3,
      },
    });

    await expect(purgeMember({ db, session: editor }, member.id)).rejects.toMatchObject({ status: 403 });
    await expect(purgeMember({ db, session: admin }, member.id)).rejects.toMatchObject({ status: 409 });

    await softDeleteMember({ db, session: editor }, member.id);
    expect((await listMembers({ db, session: editor }, {})).meta.total).toBe(0);

    // An empty member purges cleanly (allotments go too)
    const fresh = await createMember({ db, session: editor }, memberBody({ name: "Fresh", mobile: "01933333333" }));
    await purgeMember({ db, session: admin }, fresh.id);
    expect(await db.member.count()).toBe(1); // the soft-deleted one remains
  });

  test("requires authentication", async () => {
    await expect(listMembers({ db, session: null }, {})).rejects.toMatchObject({ status: 401 });
    await expect(createMember({ db, session: null }, memberBody())).rejects.toMatchObject({ status: 401 });
  });

  test("joining and status dates can't be in the future (Asia/Dhaka)", async () => {
    const tomorrow = futureDay();
    await expect(createMember({ db, session: editor }, memberBody({ joiningDate: tomorrow }))).rejects.toMatchObject({ status: 422 });
    const member = await createMember({ db, session: editor }, memberBody());
    await expect(setStatus({ db, session: admin }, member.id, { status: "inactive", date: tomorrow })).rejects.toMatchObject({ status: 422 });
    await setStatus({ db, session: editor }, member.id, { status: "inactive", date: todayInDhaka() }); // today is fine
  });
});
