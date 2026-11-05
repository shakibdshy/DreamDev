import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createAuth } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { banksApi } from "./http";

let db: Database;
let auth: ReturnType<typeof createAuth>;

const TEST_ENV = {
  BETTER_AUTH_URL: "http://127.0.0.1:5999",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  disableRateLimit: true,
};

const api = () =>
  banksApi(async (request) => ({ db, session: await auth.api.getSession({ headers: request.headers }) }));

async function signInCookie(email: string, password = "password-123"): Promise<string> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function request(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, ...rest } = init;
  return new Request(`http://127.0.0.1:5999${path}`, { ...rest, headers: { ...(cookie ? { cookie } : {}), ...(rest.headers ?? {}) } });
}

beforeAll(async () => {
  db = await setupTestDb();
  auth = createAuth(TEST_ENV, db);
});

beforeEach(async () => {
  await resetDb();
  await auth.api.signUpEmail({ body: { name: "Admin", email: "admin@test.local", password: "password-123" } });
  await auth.api.signUpEmail({ body: { name: "Editor", email: "editor@test.local", password: "password-123" } });
});

describe("banks HTTP seam (real sessions, real handlers)", () => {
  test("anonymous requests are 401", async () => {
    const response = await api().getList({ request: request("/api/banks"), params: {} });
    expect(response.status).toBe(401);
  });

  test("an Editor creates and lists Bank Accounts (both roles manage them)", async () => {
    const cookie = await signInCookie("editor@test.local");
    const created = await api().postCreate({
      request: request("/api/banks", { method: "POST", cookie, body: JSON.stringify({ bankName: "DBBL", openingBalance: 25000 }) }),
      params: {},
    });
    expect(created.status).toBe(201);

    const list = await api().getList({ request: request("/api/banks", { cookie }), params: {} });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { bankName: string; currentBalance: number }[]; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.currentBalance).toBe(25000);
  });

  test("purge is Admin-only: Editor gets 403 on ?purge=true", async () => {
    const editorCookie = await signInCookie("editor@test.local");
    const adminCookie = await signInCookie("admin@test.local");
    const created = await api().postCreate({
      request: request("/api/banks", { method: "POST", cookie: adminCookie, body: JSON.stringify({ bankName: "Temp" }) }),
      params: {},
    });
    const { id } = (await created.json()) as { id: string };

    const refused = await api().deleteBank({ request: request(`/api/banks/${id}?purge=true`, { method: "DELETE", cookie: editorCookie }), params: { id } });
    expect(refused.status).toBe(403);

    const purged = await api().deleteBank({ request: request(`/api/banks/${id}?purge=true`, { method: "DELETE", cookie: adminCookie }), params: { id } });
    expect(purged.status).toBe(200);
  });
});
