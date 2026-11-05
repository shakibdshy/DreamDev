import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { seedIfEmpty } from "@DreamDev/db/seed";
import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { sessionFor } from "../test-support";
import { dashboard } from "../dashboard/service";

let db: Database;
let admin: Session;

beforeAll(async () => {
  db = await setupTestDb();
  admin = sessionFor({ id: "admin-1", role: "admin" });
});

beforeEach(async () => {
  await resetDb();
});

describe("seed", () => {
  test("refuses a non-empty database with no partial writes", async () => {
    await seedIfEmpty(db);
    const members = await db.member.count();
    await expect(seedIfEmpty(db)).rejects.toThrow(/Refusing to seed/);
    expect(await db.member.count()).toBe(members); // nothing duplicated
  });

  test("seeded data renders a fully populated Dashboard", async () => {
    const result = await seedIfEmpty(db);
    expect(result.seeded).toBe(true);

    const data = await dashboard({ db, session: admin }, undefined);
    expect(data.kpis.activeMembers).toBe(3); // 5 members − 1 inactive − 1 exited
    expect(data.kpis.totalShares).toBeGreaterThan(0);
    expect(data.kpis.thisMonthBilled).toBeGreaterThan(0);
    expect(data.kpis.thisMonthCollected).toBeGreaterThan(0);
    expect(data.kpis.totalDueOutstanding).toBeGreaterThan(0); // the partial payer owes
    expect(data.kpis.loansOutstanding).toBe(12000); // 20,000 − 8,000
    expect(data.kpis.bankBalances).toHaveLength(2);
    expect(data.monthlySeries.some((m) => m.collected > 0)).toBe(true);
    expect(data.grid.length).toBe(5);
    expect(data.topDues.length).toBeGreaterThan(0);
    expect(data.recent.length).toBe(5);
    expect(data.recent.map((r) => r.type)).toContain("transfer");
  });
});
