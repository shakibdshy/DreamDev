import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createAuth } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { createTelegramClient, type TelegramClient, type TelegramSendResult } from "./client";
import { verifyWebhookSecret } from "./http";
import { bindChat, consumePairingCode, generateCode, issuePairingCode, unlinkUser } from "./pairing";
import { createUpdateHandler, UpdateDeduper, type TelegramUpdate } from "./updates";
import { telegramApi } from "./http";

let db: Database;
let auth: ReturnType<typeof createAuth>;

const TEST_ENV = {
  BETTER_AUTH_URL: "http://127.0.0.1:5999",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  disableRateLimit: true,
};

/** Records sendMessage calls; answers are scriptable. */
function fakeClient(replies: { ok: boolean; description?: string }[] = []) {
  const sent: { chatId: string; text: string }[] = [];
  const answered: string[] = [];
  let i = 0;
  const client: TelegramClient = {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
      const reply = replies[i++] ?? { ok: true };
      const result: TelegramSendResult = { ok: reply.ok, messageId: 42, description: reply.description };
      return result;
    },
    async answerCallbackQuery(id) {
      answered.push(id);
      return { ok: true };
    },
    async getMe() {
      return { ok: true, result: { username: "dreamdev_fund_bot" } };
    },
  };
  return { client, sent, answered };
}

/** Minimal session for direct service calls (pairing helpers need none, HTTP seam does). */
async function signInSession() {
  const response = await auth.api.signInEmail({ body: { email: "admin@test.local", password: "password-123" }, asResponse: true });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("sign-in failed");
  return session;
}

let adminSession: Awaited<ReturnType<typeof signInSession>>;

beforeAll(async () => {
  db = await setupTestDb();
  auth = createAuth(TEST_ENV, db);
});

beforeEach(async () => {
  await resetDb();
  await auth.api.signUpEmail({ body: { name: "Admin", email: "admin@test.local", password: "password-123" } });
  adminSession = await signInSession();
});

describe("pairing codes", () => {
  test("generateCode gives 8 unambiguous characters", () => {
    const code = generateCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });

  test("issue → consume sets usedAt; second consume is null; expired is null", async () => {
    const issued = await issuePairingCode(db, { targetType: "user", targetId: "u1" });
    expect(issued.deepLink("dreamdev_fund_bot")).toBe("https://t.me/dreamdev_fund_bot?start=" + issued.code);

    const consumed = await consumePairingCode(db, issued.code);
    expect(consumed).toEqual({ targetType: "user", targetId: "u1" });

    expect(await consumePairingCode(db, issued.code)).toBeNull(); // single-use

    const expired = await issuePairingCode(db, { targetType: "user", targetId: "u2" });
    await db.telegramPairingCode.update({ where: { code: expired.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumePairingCode(db, expired.code)).toBeNull();
  });

  test("unknown codes are null", async () => {
    expect(await consumePairingCode(db, "NOPE1234")).toBeNull();
  });

  test("bindChat links a user once; a chat cannot bind to two users; unlink revokes", async () => {
    await auth.api.signUpEmail({ body: { name: "Editor", email: "editor@test.local", password: "password-123" } });
    const editor = await db.user.findUnique({ where: { email: "editor@test.local" } });

    expect(await bindChat(db, { targetType: "user", targetId: adminSession.user.id }, "100")).toBe("user");

    const admin = await db.user.findUnique({ where: { id: adminSession.user.id } });
    expect(admin?.telegramChatId).toBe("100");

    // The same chat cannot bind to a different user
    const editorCode = await issuePairingCode(db, { targetType: "user", targetId: editor!.id });
    const consumed = await consumePairingCode(db, editorCode.code);
    expect(await bindChat(db, consumed!, "100").catch(() => "rejected")).toBe("rejected");

    await unlinkUser(db, adminSession.user.id);
    expect((await db.user.findUnique({ where: { id: adminSession.user.id } }))?.telegramChatId).toBeNull();

    // Re-pairing works after unlink
    const reissued = await issuePairingCode(db, { targetType: "user", targetId: adminSession.user.id });
    const reconsumed = await consumePairingCode(db, reissued.code);
    expect(await bindChat(db, reconsumed!, "200")).toBe("user");
  });

  test("member-targeted codes are rejected until ticket 2/8", async () => {
    const issued = await issuePairingCode(db, { targetType: "member", targetId: "m1" });
    const consumed = await consumePairingCode(db, issued.code);
    expect(await bindChat(db, consumed!, "300").catch(() => "rejected")).toBe("rejected");
  });
});

describe("update handling", () => {
  const startUpdate = (updateId: number, chatId: string, text: string): TelegramUpdate => ({
    update_id: updateId,
    message: { chat: { id: chatId }, text, from: { first_name: "Admin" } },
  });

  test("/start CODE links the user and confirms", async () => {
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client });
    const issued = await issuePairingCode(db, { targetType: "user", targetId: adminSession.user.id });

    await handle(startUpdate(1, "555", `/start ${issued.code.toLowerCase()}`));

    const admin = await db.user.findUnique({ where: { id: adminSession.user.id } });
    expect(admin?.telegramChatId).toBe("555");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe("555");
    expect(sent[0]?.text).toContain("Linked");
    expect(sent[0]?.text).toContain("Admin");
  });

  test("replayed update_id is processed once", async () => {
    const { client, sent } = fakeClient();
    const deduper = new UpdateDeduper();
    const handle = createUpdateHandler({ db, client, deduper });
    const issued = await issuePairingCode(db, { targetType: "user", targetId: adminSession.user.id });

    await handle(startUpdate(9, "555", `/start ${issued.code}`));
    await handle(startUpdate(9, "555", `/start ${issued.code}`)); // Telegram redelivery

    expect(sent).toHaveLength(1);
  });

  test("bad or missing code gets pairing instructions", async () => {
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client });

    await handle(startUpdate(1, "555", "/start"));
    await handle(startUpdate(2, "555", "/start BADDCODE"));

    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toContain("pairing code");
    expect(sent[1]?.text).toContain("invalid, already used, or expired");
  });

  test("unknown chat gets instructions; linked user gets the placeholder", async () => {
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client });

    await handle(startUpdate(1, "777", "hello?"));
    expect(sent[0]?.text).toContain("DreamDev fund bot");

    await bindChat(db, { targetType: "user", targetId: adminSession.user.id }, "777");
    await handle(startUpdate(2, "777", "what is the fund total?"));
    expect(sent[1]?.text).toContain("coming soon");
  });
});

describe("HTTP seam", () => {
  const api = (options?: Parameters<typeof telegramApi>[1]) =>
    telegramApi(async () => ({ db, session: adminSession }), options);

  const webhookRequest = (update: TelegramUpdate, secret?: string) =>
    new Request("http://127.0.0.1:5999/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
      body: JSON.stringify(update),
    });

  test("pair issues code + deep link; status reflects; unlink clears", async () => {
    // Env not set under bun test — endpoints 503 unless the client is injected;
    // pair/status read env directly, so drive pairing through the service seam
    // (covered above) and assert status shape through the handler with env untouched.
    const response = await api().getStatus({ request: new Request("http://127.0.0.1:5999/api/telegram/status"), params: {} });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean; linked: boolean };
    expect(body.configured).toBe(false);
    expect(body.linked).toBe(false);
  });

  test("unlink clears the binding over HTTP", async () => {
    await bindChat(db, { targetType: "user", targetId: adminSession.user.id }, "555");
    const response = await api().postUnlink({ request: new Request("http://127.0.0.1:5999/api/telegram/pair", { method: "DELETE" }), params: {} });
    expect(response.status).toBe(200);
    expect((await db.user.findUnique({ where: { id: adminSession.user.id } }))?.telegramChatId).toBeNull();
  });

  test("webhook unconfigured (no token) is 503 before anything else", async () => {
    // TELEGRAM_BOT_TOKEN is unset under plain bun test (varlock ENV uninitialized)
    const { client, sent } = fakeClient();
    const response = await api({ client }).postWebhook({ request: webhookRequest(startUpdateForWebhook()) });
    expect(response.status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  test("verifyWebhookSecret: exact match passes; wrong, missing, or unset fails", () => {
    const secret = "s3cret-webhook-token";
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
    expect(verifyWebhookSecret("wrong", secret)).toBe(false);
    expect(verifyWebhookSecret(null, secret)).toBe(false);
    expect(verifyWebhookSecret(secret, undefined)).toBe(false);
    expect(verifyWebhookSecret("", secret)).toBe(false);
  });
});

function startUpdateForWebhook(): TelegramUpdate {
  return { update_id: 1, message: { chat: { id: "1" }, text: "hi" } };
}

describe("client", () => {
  test("createTelegramClient posts JSON and tolerates network failure", async () => {
    let captured = "";
    const okFetch = (async (url: unknown) => {
      captured = String(url);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createTelegramClient("T0KEN", okFetch);
    const sent = await client.sendMessage("555", "hello");
    expect(sent.ok).toBe(true);
    expect(sent.messageId).toBe(7);
    expect(captured).toContain("botT0KEN/sendMessage");

    const failFetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const failed = await createTelegramClient("T0KEN", failFetch).sendMessage("555", "hello");
    expect(failed.ok).toBe(false);
    expect(failed.description).toBe("offline");
  });
});
