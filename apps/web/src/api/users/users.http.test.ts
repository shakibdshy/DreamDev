import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createAuth } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { usersApi } from "./http";
import { createUser } from "./service";
import type { Session } from "@DreamDev/auth";

let db: Database;
let auth: ReturnType<typeof createAuth>;

const TEST_ENV = {
  BETTER_AUTH_URL: "http://127.0.0.1:5999",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  disableRateLimit: true,
};

function sessionFor(user: { id: string; role: string }): Session {
  return {
    user: { id: user.id, role: user.role, status: "active" },
    session: { id: `sess-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  } as unknown as Session;
}

/** Signs in through the real Better Auth endpoint and returns the session cookie header. */
async function signInCookie(email: string, password = "password-123"): Promise<string> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookies = response.headers.getSetCookie();
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function request(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, ...rest } = init;
  return new Request(`http://127.0.0.1:5999${path}`, {
    ...rest,
    headers: { ...(cookie ? { cookie } : {}), ...(rest.headers ?? {}) },
  });
}

beforeAll(async () => {
  db = await setupTestDb();
  auth = createAuth(TEST_ENV, db);
});

beforeEach(async () => {
  await resetDb();
  await auth.api.signUpEmail({ body: { name: "First Admin", email: "admin@test.local", password: "password-123" } });
  await auth.api.signUpEmail({ body: { name: "Editor", email: "editor@test.local", password: "password-123" } });
});

const api = usersApi(async (request) => ({ db, session: await auth.api.getSession({ headers: request.headers }) }));

describe("users HTTP seam (real sessions, real handlers)", () => {
  test("anonymous requests are 401", async () => {
    const response = await api.getList({ request: request("/api/users"), params: {} });
    expect(response.status).toBe(401);
  });

  test("Editor requests are 403 with a JSON error body", async () => {
    const cookie = await signInCookie("editor@test.local");
    const response = await api.getList({ request: request("/api/users", { cookie }), params: {} });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Admin role required");
  });

  test("Admin requests are 200 with the pagination contract", async () => {
    const cookie = await signInCookie("admin@test.local");
    const response = await api.getList({ request: request("/api/users?page=1&pageSize=10", { cookie }), params: {} });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; meta: { page: number; pageSize: number; total: number } };
    expect(body.meta).toEqual({ page: 1, pageSize: 10, total: 2 });
    expect(body.data).toHaveLength(2);
  });

  test("a role change takes effect on the target's very next request", async () => {
    const adminCookie = await signInCookie("admin@test.local");
    const editorCookie = await signInCookie("editor@test.local");
    const editor = await db.user.findUnique({ where: { email: "editor@test.local" } });

    // Promote: the editor's existing session immediately gains admin
    const promoted = await api.patchUpdate({
      request: request(`/api/users/${editor!.id}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ role: "admin" }) }),
      params: { id: editor!.id },
    });
    expect(promoted.status).toBe(200);
    expect((await api.getList({ request: request("/api/users", { cookie: editorCookie }), params: {} })).status).toBe(200);

    // Demote back: the same session immediately loses it
    await api.patchUpdate({
      request: request(`/api/users/${editor!.id}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ role: "editor" }) }),
      params: { id: editor!.id },
    });
    expect((await api.getList({ request: request("/api/users", { cookie: editorCookie }), params: {} })).status).toBe(403);
  });

  test("an Admin cannot demote themselves — 409, not lockout", async () => {
    const adminCookie = await signInCookie("admin@test.local");
    const admin = await db.user.findUnique({ where: { email: "admin@test.local" } });
    const response = await api.patchUpdate({
      request: request(`/api/users/${admin!.id}`, { method: "PATCH", cookie: adminCookie, body: JSON.stringify({ role: "editor" }) }),
      params: { id: admin!.id },
    });
    expect(response.status).toBe(409);
  });

  test("a password reset revokes the target's existing session", async () => {
    const adminCookie = await signInCookie("admin@test.local");
    const editorCookie = await signInCookie("editor@test.local");
    const editor = await db.user.findUnique({ where: { email: "editor@test.local" } });

    // Session works before the reset
    expect((await api.getList({ request: request("/api/users", { cookie: editorCookie }), params: {} })).status).toBe(403); // editor, but authenticated

    const response = await api.postResetPassword({
      request: request(`/api/users/${editor!.id}/reset-password`, {
        method: "POST",
        cookie: adminCookie,
        body: JSON.stringify({ newPassword: "brand-new-456" }),
      }),
      params: { id: editor!.id },
    });
    expect(response.status).toBe(200);

    // The old session cookie no longer resolves
    expect((await api.getList({ request: request("/api/users", { cookie: editorCookie }), params: {} })).status).toBe(401);
    // And the new password signs in
    const freshCookie = await signInCookie("editor@test.local", "brand-new-456");
    expect(freshCookie).toContain("better-auth");
  });

  test("createUser via service gives the new User a working sign-in (shared with the HTTP path)", async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    await createUser(
      { db, session: sessionFor(admin) },
      { name: "HTTP Made", email: "made@test.local", password: "password-123", role: "editor" },
    );
    const cookie = await signInCookie("made@test.local");
    expect((await api.getList({ request: request("/api/users", { cookie }), params: {} })).status).toBe(403); // authenticated editor
  });
});
