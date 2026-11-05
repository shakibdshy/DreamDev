import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { resetDb, setupTestDb } from "./harness";
import type { Database } from "../index";

describe("test database harness", () => {
  let db: Database;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  test("round-trip: a User row survives create and read", async () => {
    await db.user.create({ data: { id: "u1", name: "Demo User", email: "demo@test.local" } });
    const read = await db.user.findUnique({ where: { id: "u1" } });
    expect(read?.email).toBe("demo@test.local");
  });

  test("truncation between tests leaves a clean database", async () => {
    // The User created by the previous test must be gone
    const count = await db.user.count();
    expect(count).toBe(0);
  });

  test("schema is applied: auth tables are queryable", async () => {
    // Round-trip already proved `user`; these throw if their tables are missing
    await db.session.count();
    await db.account.count();
  });
});
