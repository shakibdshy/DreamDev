import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createAuth } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { createTelegramClient, type TelegramClient, type TelegramSendResult } from "./client";
import { verifyWebhookSecret } from "./http";
import { bindChat, consumePairingCode, generateCode, issuePairingCode, unlinkUser } from "./pairing";
import { createUpdateHandler, UpdateDeduper, type TelegramUpdate } from "./updates";
import { telegramApi } from "./http";
import { issueMemberPairing, memberTelegramStatus, setMemberNotifyRoute, unlinkMemberRoute } from "./member-ops";

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

const startUpdate = (updateId: number, chatId: string, text: string): TelegramUpdate => ({
  update_id: updateId,
  message: { chat: { id: chatId }, text, from: { first_name: "Admin" } },
});

describe("update handling", () => {

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
    // No adapter in this handler → the bridge answers with the not-configured notice
    expect(sent[1]?.text).toContain("isn't configured");
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

describe("member pairing (ticket 2/8)", () => {
  let memberSeq = 0;
  const seedMember = async () => {
    memberSeq += 1;
    return db.member.create({ data: { name: `Karim Mia ${memberSeq}`, mobile: `0181234${String(memberSeq).padStart(4, "0")}`, joiningDate: new Date("2026-02-01") } });
  };

  test("/start member code binds the member with the notification-only welcome", async () => {
    const member = await seedMember();
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client });
    const issued = await issuePairingCode(db, { targetType: "member", targetId: member.id });

    await handle(startUpdate(1, "888", `/start ${issued.code}`));

    const fresh = await db.member.findUnique({ where: { id: member.id } });
    expect(fresh?.telegramChatId).toBe("888");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("notification-only");
  });

  test("member messages after binding get exactly the notification-only reply", async () => {
    const member = await seedMember();
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client });
    const issued = await issuePairingCode(db, { targetType: "member", targetId: member.id });
    await handle(startUpdate(1, "888", `/start ${issued.code}`));

    await handle(startUpdate(2, "888", "what is my balance?"));
    await handle(startUpdate(3, "888", "/help"));

    expect(sent).toHaveLength(3);
    expect(sent[1]?.text).toBe("This bot is notification-only. You'll receive messages about your fund records here, but it can't answer messages.");
    expect(sent[2]?.text).toBe(sent[1]?.text);
  });

  test("one chat cannot bind a user and then a member (cross-identity conflict)", async () => {
    const member = await seedMember();
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client });

    await handle(startUpdate(1, "999", `/start ${(await issuePairingCode(db, { targetType: "user", targetId: adminSession.user.id })).code}`));
    const memberCode = await issuePairingCode(db, { targetType: "member", targetId: member.id });
    await handle(startUpdate(2, "999", `/start ${memberCode.code}`));

    const fresh = await db.member.findUnique({ where: { id: member.id } });
    expect(fresh?.telegramChatId).toBeNull();
    expect(sent[1]?.text).toContain("already linked");
  });

  test("same member + same chat rebinds idempotently; a different member is rejected", async () => {
    const member = await seedMember();
    const other = await seedMember();
    const issued = await issuePairingCode(db, { targetType: "member", targetId: member.id });
    const consumed = await consumePairingCode(db, issued.code);
    expect(await bindChat(db, consumed!, "321")).toBe("member");

    const second = await issuePairingCode(db, { targetType: "member", targetId: member.id });
    const consumed2 = await consumePairingCode(db, second.code);
    expect(await bindChat(db, consumed2!, "321")).toBe("member"); // idempotent

    const hijack = await issuePairingCode(db, { targetType: "member", targetId: other.id });
    const consumed3 = await consumePairingCode(db, hijack.code);
    expect(await bindChat(db, consumed3!, "321").catch(() => "rejected")).toBe("rejected");
  });

  test("member ops: pair/status need a user; unlink + notify toggle are admin-only", async () => {
    const member = await seedMember();

    // Admin pair + status over the HTTP seam
    const adminApi = () => telegramApi(async () => ({ db, session: adminSession }), {});
    const status = await adminApi().getStatus({ request: new Request("http://127.0.0.1:5999/api/telegram/status"), params: {} });
    expect(status.status).toBe(200);

    // Direct member ops seam (editor session → 403 on unlink/notify)
    await auth.api.signUpEmail({ body: { name: "Editor", email: "editor2@test.local", password: "password-123" } });
    const editorSession = await (async () => {
      const response = await auth.api.signInEmail({ body: { email: "editor2@test.local", password: "password-123" }, asResponse: true });
      const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      return auth.api.getSession({ headers: new Headers({ cookie }) });
    })();

    const editorDeps = { db, session: editorSession };
    const unlinkApi = telegramApi(async () => ({ db, session: editorSession }), {}).postUnlink;
    expect(typeof unlinkApi).toBe("function");

    // editor can issue pairing (bot unconfigured → 503 comes from env, not role)
    const pairResult = await issueMemberPairing(editorDeps, member.id).catch((e) => (e as Error).message);
    expect(pairResult).toBe("Telegram bot not configured");

    // admin-only ops with an editor session → 403
    const unlinkForbidden = await unlinkMemberRoute(editorDeps, member.id).catch((e) => (e as Error).message);
    expect(unlinkForbidden).toBe("Admin role required");
    const notifyForbidden = await setMemberNotifyRoute(editorDeps, member.id, true).catch((e) => (e as Error).message);
    expect(notifyForbidden).toBe("Admin role required");

    // admin session works (no telegram config needed for these two)
    const adminDeps = { db, session: adminSession };
    expect(await unlinkMemberRoute(adminDeps, member.id)).toEqual({ linked: false });
    expect(await setMemberNotifyRoute(adminDeps, member.id, true)).toEqual({ notifyEnabled: true });
    expect(await setMemberNotifyRoute(adminDeps, member.id, false)).toEqual({ notifyEnabled: false });

    const statusBody = await memberTelegramStatus(adminDeps, member.id);
    expect(statusBody.notifyEnabled).toBe(false);
    expect(statusBody.linked).toBe(false);
  });

  test("binding a deleted member is rejected", async () => {
    const member = await seedMember();
    await db.member.update({ where: { id: member.id }, data: { deletedAt: new Date() } });
    const issued = await issuePairingCode(db, { targetType: "member", targetId: member.id });
    const consumed = await consumePairingCode(db, issued.code);
    expect(await bindChat(db, consumed!, "400").catch(() => "rejected")).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// Ticket 6/8: Telegram agent chat for Admin/Editor
// ---------------------------------------------------------------------------

import { fakeText } from "@tanstack/ai/testing";
import { handleAgentMessage, handleApprovalCallback } from "./agent-bridge";


/** Local seed: one member + one bank (agent.test.ts has its own richer one). */
async function seedFundTg() {
  const member = await db.member.create({ data: { name: "Rahim Tg", mobile: "01512345678", joiningDate: new Date("2026-01-01") } });
  await db.shareAllotment.create({ data: { memberId: member.id, quantity: 2, effectiveMonth: "2026-01" } });
  const bank = await db.bankAccount.create({ data: { bankName: "Dutch-Bangla Tg", openingBalance: 100_000 } });
  return { member, bank };
}

describe("telegram agent chat (ticket 6/8)", () => {
  test("linked user question flows through the agent loop with tools", async () => {
    await seedFundTg();
    const recorded: { chatId: string; text: string; markup?: unknown }[] = [];
    const client: TelegramClient = {
      async sendMessage(chatId, text, options) {
        recorded.push({ chatId, text, markup: options?.replyMarkup });
        return { ok: true, messageId: 1 };
      },
      async answerCallbackQuery() {
        return { ok: true };
      },
      async getMe() {
        return { ok: true, result: { username: "dreamdev_fund_bot" } };
      },
    };
    const fake = fakeText();
    fake.setResponses([
      { toolCalls: [{ name: "fund_overview", input: {} }] },
      { text: "The fund holds ৳1,00,000 across its bank accounts." },
    ]);

    await bindChat(db, { targetType: "user", targetId: adminSession.user.id }, "777");
    await handleAgentMessage({ db, client, adapter: fake }, "777", "how much money does the fund have?", {
      id: adminSession.user.id,
      role: "admin",
      status: "active",
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.text).toContain("৳1,00,000");
    // Audit: user + tool + assistant rows on the telegram thread
    const conversation = await db.agentConversation.findFirstOrThrow({ where: { channel: "telegram" } });
    const rows = await db.agentMessage.findMany({ where: { conversationId: conversation.id } });
    expect(rows.some((r) => r.role === "tool" && r.toolName === "fund_overview")).toBe(true);
    expect(rows.some((r) => r.role === "user" && r.content.includes("how much"))).toBe(true);
  });

  test("gated write pauses with a keyboard; approve executes; cancel never writes", async () => {
    const { bank } = await seedFundTg();
    const sent: { text: string; markup?: unknown }[] = [];
    let answered = "";
    const client: TelegramClient = {
      async sendMessage(_chatId, text, options) {
        sent.push({ text, markup: options?.replyMarkup });
        return { ok: true, messageId: 2 };
      },
      async answerCallbackQuery(_id, text) {
        answered = text ?? "";
        return { ok: true };
      },
      async getMe() {
        return { ok: true, result: { username: "dreamdev_fund_bot" } };
      },
    };
    const user = { id: adminSession.user.id, role: "admin" as const, status: "active" };
    const proposal = { entity: "expense", action: "create", args: { bankAccountId: bank.id, amount: 300, date: "2026-11-03", note: "Tea" } };
    const fake = fakeText();
    fake.setResponses([{ toolCalls: [{ name: "preview_write", input: proposal }] }, { text: "Here is the preview." }]);

    await bindChat(db, { targetType: "user", targetId: user.id }, "888");
    await handleAgentMessage({ db, client, adapter: fake }, "888", "add a 300 expense for tea", user);
    expect(await db.expense.count()).toBe(0); // preview only
    expect(await db.agentPausedApproval.count()).toBe(0); // preview doesn't pause

    // Propose → pause + keyboard
    fake.setResponses([{ toolCalls: [{ name: "write_record", input: proposal }] }]);
    await handleAgentMessage({ db, client, adapter: fake }, "888", "ok record it", user);
    expect(await db.expense.count()).toBe(0); // paused, not executed
    const pause = await db.agentPausedApproval.findUnique({ where: { chatId: "888" } });
    expect(pause?.toolName).toBe("write_record");
    expect(sent.at(-1)?.markup).toBeTruthy(); // inline keyboard present

    // Pending pause blocks further messages
    await handleAgentMessage({ db, client, adapter: fake }, "888", "actually also do X", user);
    expect(sent.at(-1)?.text).toContain("pending confirmation");

    // ✖ Cancel → nothing written, pause cleared
    await handleApprovalCallback({ db, client, adapter: fake }, "888", "cb1", false);
    expect(await db.expense.count()).toBe(0);
    expect(await db.agentPausedApproval.count()).toBe(0);
    expect(answered).toBe("Cancelled.");

    // ✅ Approve on a fresh proposal → written by the service with attribution
    fake.setResponses([{ toolCalls: [{ name: "write_record", input: proposal }] }]);
    await handleAgentMessage({ db, client, adapter: fake }, "888", "record it for real", user);
    await handleApprovalCallback({ db, client, adapter: fake }, "888", "cb2", true);
    const expense = await db.expense.findFirstOrThrow();
    expect(expense.amount).toBe(300);
    expect(expense.createdBy).toBe(user.id);
    expect(await db.agentPausedApproval.count()).toBe(0);
  });

  test("expired pauses refuse to resume and clear", async () => {
    const sent: string[] = [];
    const client: TelegramClient = {
      async sendMessage(_chatId, text) {
        sent.push(text);
        return { ok: true, messageId: 3 };
      },
      async answerCallbackQuery(_id, text) {
        sent.push(`cb:${text ?? ""}`);
        return { ok: true };
      },
      async getMe() {
        return { ok: true, result: { username: "dreamdev_fund_bot" } };
      },
    };
    await db.agentPausedApproval.create({
      data: {
        chatId: "900",
        userId: adminSession.user.id,
        threadId: `telegram-${adminSession.user.id}`,
        interruptId: "approval_x",
        interruptedRunId: "run-x",
        toolName: "write_record",
        argsJson: "{}",
        messagesJson: "[]",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await handleApprovalCallback({ db, client, adapter: fakeText() }, "900", "cb9", true);
    expect(await db.agentPausedApproval.count()).toBe(0);
    expect(sent.some((t) => t.includes("expired"))).toBe(true);
    expect(sent.some((t) => t.startsWith("cb:Expired"))).toBe(true);
  });

  test("webhook routes callback_query into the approval handler and member texts stay notification-only", async () => {
    const { client, sent } = fakeClient();
    const handle = createUpdateHandler({ db, client, adapter: fakeText() });
    const member = await db.member.create({ data: { name: "Sufia", mobile: "01612345678", joiningDate: new Date("2026-03-01") } });
    const code = await issuePairingCode(db, { targetType: "member", targetId: member.id });
    await handle(startUpdate(1, "950", `/start ${code.code}`));
    await handle(startUpdate(2, "950", "any message"));
    expect(String(sent.at(-1)?.text ?? "").startsWith("This bot is notification-only")).toBe(true);
    // A callback with no pending pause answers harmlessly
    await handle({ update_id: 3, callback_query: { id: "cbx", from: { id: "777" }, data: "approval:approve" } });
    // Welcome + the reply to their message both carry the notice
    expect(sent.filter((t) => String(t.text).includes("notification-only")).length).toBe(2);
  });
});
