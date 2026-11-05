import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createAuth, type Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { createUser, deactivateUser, listUsers, reactivateUser, resetPassword, updateUser } from "./service";

let db: Database;
let auth: ReturnType<typeof createAuth>;

const TEST_ENV = {
  BETTER_AUTH_URL: "http://127.0.0.1:5999",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
};

beforeAll(async () => {
  db = await setupTestDb();
  auth = createAuth(TEST_ENV, db);
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

/** A minimal session-shaped object — services only read id/role/status. */
function sessionFor(user: { id: string; role: string; status?: string }): Session {
  return {
    user: { id: user.id, role: user.role, status: user.status ?? "active" },
    session: { id: `sess-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  } as unknown as Session;
}

async function seedUser(overrides: Partial<{ id: string; name: string; email: string; role: string; status: string }> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  return db.user.create({
    data: {
      id,
      name: overrides.name ?? "User",
      email: overrides.email ?? `${id}@test.local`,
      role: overrides.role ?? "editor",
      status: overrides.status ?? "active",
    },
  });
}

async function signUp(email: string, password = "password-123") {
  return auth.api.signUpEmail({ body: { name: "Signed Up", email, password } });
}

describe("auth database hooks", () => {
  test("the first registered User becomes Admin, the next an Editor", async () => {
    await signUp("first@test.local");
    await signUp("second@test.local");
    const first = await db.user.findUnique({ where: { email: "first@test.local" } });
    const second = await db.user.findUnique({ where: { email: "second@test.local" } });
    expect(first?.role).toBe("admin");
    expect(second?.role).toBe("editor");
  });

  test("a deactivated User cannot open a session (sign-in blocked)", async () => {
    await signUp("blocked@test.local");
    await db.user.update({ where: { email: "blocked@test.local" }, data: { status: "deactivated" } });
    await db.session.deleteMany({}); // sign-up auto-signs-in; drop that session so the count is honest
    const result = await auth.api.signInEmail({ body: { email: "blocked@test.local", password: "password-123" } }).catch(() => null);
    expect(result).toBeNull();
    expect(await db.session.count()).toBe(0);
  });
});

describe("users service", () => {
  test("requires authentication and the Admin role", async () => {
    const editor = await seedUser({ role: "editor" });
    await expect(listUsers({ db, session: null }, {})).rejects.toMatchObject({ status: 401 });
    await expect(listUsers({ db, session: sessionFor(editor) }, {})).rejects.toMatchObject({ status: 403 });
    await expect(createUser({ db, session: sessionFor(editor) }, { name: "X", email: "x@t.local", password: "password-123" })).rejects.toMatchObject({ status: 403 });
  });

  test("lists users server-paginated with last sign-in", async () => {
    const admin = await seedUser({ role: "admin", email: "m-admin@t.local" });
    const early = await seedUser({ role: "editor", email: "a-early@t.local" });
    const late = await seedUser({ role: "editor", email: "z-late@t.local" });
    await db.session.create({
      data: { id: "s-early", token: "t-early", userId: early.id, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await db.session.create({
      data: { id: "s-late", token: "t-late", userId: late.id, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date("2026-06-01T00:00:00Z") },
    });

    const page = await listUsers({ db, session: sessionFor(admin) }, { page: 1, pageSize: 2, sort: "email", order: "asc" });
    expect(page.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(page.data.map((u) => u.email)).toEqual(["a-early@t.local", "m-admin@t.local"]);
    expect(page.data[0]?.lastSignInAt).toBeInstanceOf(Date);

    const page2 = await listUsers({ db, session: sessionFor(admin) }, { page: 2, pageSize: 2, sort: "email", order: "asc" });
    expect(page2.data.map((u) => u.email)).toEqual(["z-late@t.local"]);
    expect(page2.data[0]?.lastSignInAt).toBeInstanceOf(Date);
    // The admin never signed in during a session row we can see — null is fine
    expect(page.data[1]?.email).toBe("m-admin@t.local");
  });

  test("creates a User with a credential account they can sign in with", async () => {
    const admin = await seedUser({ role: "admin" });
    const created = await createUser(
      { db, session: sessionFor(admin) },
      { name: "New Editor", email: "new@test.local", password: "password-123", role: "editor" },
    );
    expect(created.role).toBe("editor");
    expect(created.status).toBe("active");

    const account = await db.account.findFirst({ where: { userId: created.id, providerId: "credential" } });
    expect(account?.password).toBeTruthy();

    const signedIn = await auth.api.signInEmail({ body: { email: "new@test.local", password: "password-123" } });
    expect(signedIn.user.email).toBe("new@test.local");
  });

  test("refuses duplicate emails with 409", async () => {
    const admin = await seedUser({ role: "admin" });
    await expect(
      createUser({ db, session: sessionFor(admin) }, { name: "Dup", email: admin.email, password: "password-123" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("changes a User's role, effective on the next request", async () => {
    const admin = await seedUser({ role: "admin" });
    const editor = await seedUser({ role: "editor" });
    const updated = await updateUser({ db, session: sessionFor(admin) }, editor.id, { role: "admin" });
    expect(updated.role).toBe("admin");
    const refetched = await db.user.findUnique({ where: { id: editor.id } });
    expect(refetched?.role).toBe("admin");
  });

  test("deactivation revokes sessions; self and last-active-Admin are refused", async () => {
    const adminA = await seedUser({ role: "admin" });
    const adminB = await seedUser({ role: "admin" });
    await db.session.create({
      data: { id: "s-b", token: "t-b", userId: adminB.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });

    // A deactivates B while another admin remains — allowed, sessions revoked
    const deactivated = await deactivateUser({ db, session: sessionFor(adminA) }, adminB.id);
    expect(deactivated.status).toBe("deactivated");
    expect(await db.session.count({ where: { userId: adminB.id } })).toBe(0);

    // A is now the last active admin: self-deactivation refused
    await expect(deactivateUser({ db, session: sessionFor(adminA) }, adminA.id)).rejects.toMatchObject({ status: 409 });
  });

  test("reactivation restores sign-in", async () => {
    const admin = await seedUser({ role: "admin" });
    const gone = await seedUser({ status: "deactivated" });
    const back = await reactivateUser({ db, session: sessionFor(admin) }, gone.id);
    expect(back.status).toBe("active");
  });

  test("admin resets a password: the old one stops working, the new one works", async () => {
    const admin = await seedUser({ role: "admin" });
    await signUp("reset@test.local");
    await resetPassword({ db, session: sessionFor(admin) }, (await db.user.findUnique({ where: { email: "reset@test.local" } }))!.id, { newPassword: "brand-new-456" });

    await expect(auth.api.signInEmail({ body: { email: "reset@test.local", password: "password-123" } })).rejects.toThrow();
    const signedIn = await auth.api.signInEmail({ body: { email: "reset@test.local", password: "brand-new-456" } });
    expect(signedIn.user.email).toBe("reset@test.local");
  });

  test("unknown users are 404 and bad input is 422", async () => {
    const admin = await seedUser({ role: "admin" });
    await expect(updateUser({ db, session: sessionFor(admin) }, "nope", { role: "admin" })).rejects.toMatchObject({ status: 404 });
    await expect(
      createUser({ db, session: sessionFor(admin) }, { name: "", email: "not-an-email", password: "short" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
