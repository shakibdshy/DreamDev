import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fakeText } from "@tanstack/ai/testing";

import { createAuth } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { setupTestDb, resetDb } from "@DreamDev/db/test/harness";

import { agentStream, createRateLimiter, ensureConversation, messageText, RateLimitError } from "./agent";
import { readTools } from "./tools";
import { agentApi } from "./http";

let db: Database;
let auth: ReturnType<typeof createAuth>;

const TEST_ENV = {
  BETTER_AUTH_URL: "http://127.0.0.1:5999",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890",
  disableRateLimit: true,
};

const api = (options?: Parameters<typeof agentApi>[1]) =>
  agentApi(async () => ({ db, session: adminSession }), options);

let adminSession: Awaited<ReturnType<typeof signInSession>>;

/** Signs in the seeded admin and returns the resolved session shape. */
async function signInSession() {
  const response = await auth.api.signInEmail({ body: { email: "admin@test.local", password: "password-123" }, asResponse: true });
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("sign-in failed");
  return session;
}

async function seedFund() {
  const member = await db.member.create({ data: { name: "Rahim Uddin", mobile: "01712345678", joiningDate: new Date("2026-01-01") } });
  // Billing starts at the first Share Allotment (createMember normally makes it)
  await db.shareAllotment.create({ data: { memberId: member.id, quantity: 2, effectiveMonth: "2026-01" } });
  const bank = await db.bankAccount.create({ data: { bankName: "Dutch-Bangla Bank", openingBalance: 100_000 } });
  await db.contribution.create({
    data: { memberId: member.id, bankAccountId: bank.id, amount: 10_000, creditDate: new Date("2026-10-05"), sharePriceAtEntry: 5000, shareQtyAtEntry: 2 },
  });
  return { member, bank };
}

/** A chat request body in the AG-UI RunAgentInput wire shape the panel sends. */
const wireBody = (text: string) => ({
  threadId: "web-any",
  runId: `run-${Math.random().toString(36).slice(2)}`,
  messages: [{ id: `m-${Math.random().toString(36).slice(2)}`, role: "user", content: text }],
  tools: [],
  context: [],
});

/** Collects the final answer text out of an agent chunk stream. */
async function collect(stream: AsyncIterable<{ type: string }>) {
  let text = "";
  let error: string | undefined;
  for await (const chunk of stream) {
    const c = chunk as { type: string; delta?: unknown; message?: unknown };
    if (c.type === "TEXT_MESSAGE_CONTENT") text += typeof c.delta === "string" ? c.delta : "";
    if (c.type === "RUN_ERROR") error = typeof c.message === "string" ? c.message : String(c.message ?? "run error");
  }
  return { text, error };
}

const ctxFor = () => ({ db, session: adminSession, channel: "web" as const });

beforeAll(async () => {
  db = await setupTestDb();
  auth = createAuth(TEST_ENV, db);
});

beforeEach(async () => {
  await resetDb();
  await auth.api.signUpEmail({ body: { name: "Admin", email: "admin@test.local", password: "password-123" } });
  adminSession = await signInSession();
});

describe("read tools over real services", () => {
  test("list_members resolves a fuzzy name with positions", async () => {
    await seedFund();
    const memberTool = readTools().find((t) => t.name === "list_members")!;
    const result = await (memberTool as unknown as { execute: (input: unknown, ctx: unknown) => Promise<{ members: { name: string; due: number }[] }> })
      .execute({ search: "rahim" }, { context: ctxFor() });
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.name).toBe("Rahim Uddin");
  });

  test("member_position returns due and advance", async () => {
    await seedFund();
    const tool = readTools().find((t) => t.name === "member_position")!;
    const member = await db.member.findFirstOrThrow();
    const result = await (tool as unknown as { execute: (input: unknown, ctx: unknown) => Promise<{ due: number; name: string }> })
      .execute({ memberId: member.id }, { context: ctxFor() });
    expect(result.name).toBe("Rahim Uddin");
    // Jan..Nov billed at 2 shares × ৳5000 = 110000; paid 10000 → due 100000
    expect(result.due).toBe(100_000);
  });

  test("write tools do not exist in the registry (read-only version)", () => {
    const forbidden = ["create_", "update_", "delete_", "set_", "change_", "record_"];
    for (const tool of readTools()) {
      for (const prefix of forbidden) expect(tool.name.startsWith(prefix)).toBe(false);
    }
  });
});

describe("agent loop with the fake model", () => {
  test("model calls a tool, gets the result, and the answer streams back", async () => {
    await seedFund();
    const fake = fakeText();
    fake.setResponses([
      { toolCalls: [{ name: "fund_overview", input: {} }] },
      { text: "The fund holds ৳1,00,000 in Dutch-Bangla Bank." },
    ]);

    const ctx = ctxFor();
    const threadId = "web-admin-1";
    const conversationId = await ensureConversation(db, ctx, threadId);
    const { text, error } = await collect(
      agentStream({
        ctx,
        params: { messages: [{ role: "user", content: "How much money does the fund have?" }] },
        adapter: fake,
        threadId,
        conversationId,
      }),
    );
    expect(error).toBeUndefined();
    expect(text).toContain("Dutch-Bangla Bank");
    expect(fake.state.callCount).toBe(2);

    // Audit trail: tool call + assistant answer persisted
    const rows = await db.agentMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
    const toolRow = rows.find((r) => r.role === "tool");
    expect(toolRow?.toolName).toBe("fund_overview");
    const answerRow = rows.find((r) => r.role === "assistant");
    expect(answerRow?.content).toContain("Dutch-Bangla Bank");
  });

  test("conversation + user message rows are keyed per user/thread", async () => {
    const ctx = ctxFor();
    const conversationId = await ensureConversation(db, ctx, "web-admin-1");
    const again = await ensureConversation(db, ctx, "web-admin-1");
    expect(again).toBe(conversationId);
    expect(await db.agentConversation.count()).toBe(1);
  });

  test("messageText flattens string and part-array content", () => {
    expect(messageText({ role: "user", content: "hello" })).toBe("hello");
    expect(messageText({ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
  });

  test("a model error surfaces as RUN_ERROR with no answer persisted", async () => {
    const fake = fakeText();
    fake.setResponses([{ error: "provider down" }]);
    const ctx = ctxFor();
    const conversationId = await ensureConversation(db, ctx, "web-admin-1");
    const { error } = await collect(
      agentStream({ ctx, params: { messages: [{ role: "user", content: "hi" }] }, adapter: fake, threadId: "web-admin-1", conversationId }),
    );
    expect(error).toBe("provider down");
    const rows = await db.agentMessage.findMany({ where: { conversationId } });
    expect(rows.some((r) => r.content.includes("provider down"))).toBe(true);
  });
});

describe("rate limiter", () => {
  test("blocks after the hourly limit and clears when the window passes", () => {
    const limiter = createRateLimiter(2);
    limiter.check("u1", 1_000);
    limiter.check("u1", 2_000);
    expect(() => limiter.check("u1", 3_000)).toThrow(RateLimitError);
    limiter.check("u1", 3_601_001 + 2_000); // window has passed
    limiter.check("u2", 1_000); // other users unaffected
  });
});

describe("HTTP seam", () => {
  test("503 with a friendly message when no adapter is configured", async () => {
    const response = await api({}).postChat({
      request: new Request("http://127.0.0.1:5999/api/agent/chat", { method: "POST", body: JSON.stringify(wireBody("hi")) }),
    });
    expect(response.status).toBe(503);
  });

  test("429 when the per-user limit is exceeded", async () => {
    const fake = fakeText();
    fake.setResponses(Array.from({ length: 6 }, () => ({ text: "ok" })));
    const limited = api({ adapter: fake, rateLimitPerHour: 2 });
    const call = () =>
      limited.postChat({
        request: new Request("http://127.0.0.1:5999/api/agent/chat", {
          method: "POST",
          body: JSON.stringify(wireBody("hi")),
        }),
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  test("getHistory returns persisted messages oldest first", async () => {
    await seedFund();
    const fake = fakeText();
    fake.setResponses([{ toolCalls: [{ name: "list_members", input: { search: "rahim" } }] }, { text: "Rahim is active." }]);
    const ctx = ctxFor();
    const threadId = `web-${adminSession.user.id}`; // the same derivation the route uses
    const conversationId = await ensureConversation(db, ctx, threadId);
    await db.agentMessage.create({ data: { conversationId, role: "user", content: "What is Rahim's status?" } });
    await collect(agentStream({ ctx, params: { messages: [{ role: "user", content: "What is Rahim's status?" }] }, adapter: fake, threadId, conversationId }));

    const response = await api({ adapter: fake }).getHistory({ request: new Request("http://127.0.0.1:5999/api/agent/chat"), params: {} });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: { role: string; parts: { content: string }[] }[] };
    expect(body.messages[0]?.role).toBe("user");
    expect(body.messages[0]?.parts[0]?.content).toContain("Rahim");
    expect(body.messages.at(-1)?.role).toBe("assistant");
  });
});

// ---------------------------------------------------------------------------
// Ticket 4/8: confirm gate + contribution writes
// ---------------------------------------------------------------------------

import { previewContributionDef, recordContributionDef } from "./contribution-tools";
import { contributionPreview } from "./tools";

/** Collects chunks, exposing tool results and interrupt bindings. */
async function collectGate(stream: AsyncIterable<unknown>) {
  let text = "";
  let error: string | undefined;
  let interruptedRunId: string | undefined;
  let interruptId: string | undefined;
  let snapshotMessages: unknown[] = [];
  let toolResults: { ok?: boolean; error?: unknown }[] = [];
  for await (const rawChunk of stream) {
    const chunk = rawChunk as Record<string, unknown>;
    const c = chunk as {
      type: string;
      content?: unknown;
      delta?: unknown;
      message?: unknown;
      ok?: boolean;
      error?: unknown;
      outcome?: { type: string; interrupts?: { id: string; metadata?: { "tanstack:interruptBinding"?: { interruptedRunId: string; interruptId: string } } }[] };
    };
    if (c.type === "TEXT_MESSAGE_CONTENT") text += String(c.delta ?? "");
    if (c.type === "RUN_ERROR") error = String(c.message ?? "run error");
    if (c.type === "TOOL_CALL_RESULT") {
      // Validation failures arrive as content JSON {"error": "..."} — no ok flag.
      let contentError: string | undefined;
      try {
        const parsed = typeof c.content === "string" ? JSON.parse(c.content) : c.content;
        if (parsed && typeof parsed === "object" && "error" in parsed) contentError = String((parsed as { error: unknown }).error);
      } catch {
        /* non-JSON content */
      }
      toolResults.push({ ok: c.ok, error: c.error ?? contentError });
    }
    if (c.type === "MESSAGES_SNAPSHOT") snapshotMessages = (chunk as { messages: unknown[] }).messages;
    if (c.type === "RUN_FINISHED" && c.outcome?.type === "interrupt") {
      const binding = c.outcome.interrupts?.[0]?.metadata?.["tanstack:interruptBinding"];
      interruptedRunId = binding?.interruptedRunId;
      interruptId = binding?.interruptId;
    }
  }
  return { text, error, interruptedRunId, interruptId, snapshotMessages, toolResults };
}

describe("confirm gate: contribution writes (ticket 4/8)", () => {
  const proposeInput = (memberId: string, bankAccountId: string, overrides: Record<string, unknown> = {}) => ({
    memberId,
    bankAccountId,
    amount: 10_000,
    creditDate: "2026-10-20",
    ...overrides,
  });

  test("preview returns canonical names and the due math", async () => {
    const { member, bank } = await seedFund();
    const preview = await contributionPreview({
      db, session: adminSession, memberId: member.id, bankAccountId: bank.id, amount: 10_000, creditDate: "2026-10-20",
    });
    expect(preview.memberName).toBe("Rahim Uddin");
    expect(preview.bankName).toBe("Dutch-Bangla Bank");
    expect(preview.dueBefore).toBe(100_000);
    expect(preview.dueAfter).toBe(90_000);
    expect(preview.advanceAfter).toBe(0);
    expect(preview.sharePrice).toBe(5000);
  });

  test("preview flips to Advance when the payment overpays", async () => {
    const { member, bank } = await seedFund();
    const preview = await contributionPreview({
      db, session: adminSession, memberId: member.id, bankAccountId: bank.id, amount: 120_000, creditDate: "2026-10-20",
    });
    expect(preview.dueAfter).toBe(-20_000);
    expect(preview.advanceAfter).toBe(20_000);
  });

  test("unknown bank id in a proposal is a tool error, never a write", async () => {
    const { member } = await seedFund();
    expect(
      contributionPreview({ db, session: adminSession, memberId: member.id, bankAccountId: "nope", amount: 1000, creditDate: "2026-10-20" }).catch(() => "tool error"),
    ).resolves.toBe("tool error");
  });

  test("approval pauses without writing; approved resume writes with attribution", async () => {
    const { member, bank } = await seedFund();
    const fake = fakeText();
    fake.setResponses([{ toolCalls: [{ name: "record_contribution", input: proposeInput(member.id, bank.id) }] }]);

    const ctx = ctxFor();
    const threadId = `web-${adminSession.user.id}`;
    const conversationId = await ensureConversation(db, ctx, threadId);
    await db.agentMessage.create({ data: { conversationId, role: "user", content: "record 10000 for Rahim" } });

    // Run 1: the proposal pauses on the gate — zero writes.
    const paused = await collectGate(agentStream({ ctx, params: { messages: [{ id: "1", role: "user", content: "record 10000 for Rahim" }] }, adapter: fake, threadId, conversationId }));
    expect(paused.interruptId).toBeDefined();
    expect(paused.interruptedRunId).toBeDefined();
    expect(await db.contribution.count()).toBe(1); // only the seeded one
    expect(await db.contribution.count({ where: { creditDate: new Date("2026-10-20T00:00:00Z") } })).toBe(0);

    // Run 2: approved resume — the service writes exactly as the dashboard would.
    fake.appendResponses([{ text: "Recorded ৳10,000 for Rahim Uddin." }]);
    const resumed = await collectGate(agentStream({
      ctx,
      params: {
        messages: paused.snapshotMessages as never,
        runId: "resume-run",
        parentRunId: paused.interruptedRunId,
        resume: [{ interruptId: paused.interruptId!, status: "resolved", payload: { approved: true } }] as never,
      },
      adapter: fake,
      threadId,
      conversationId,
    }));
    expect(resumed.error).toBeUndefined();
    const created = await db.contribution.findFirst({ where: { creditDate: new Date("2026-10-20T00:00:00Z") } });
    expect(created?.amount).toBe(10_000);
    expect(created?.createdBy).toBe(adminSession.user.id); // attribution
    expect(created?.sharePriceAtEntry).toBe(5000); // snapshot invariant intact
    expect(created?.shareQtyAtEntry).toBe(2);

    // Audit recorded the gated write
    const toolRows = await db.agentMessage.findMany({ where: { conversationId, role: "tool" } });
    expect(toolRows.some((r) => r.toolName === "record_contribution")).toBe(true);
  });

  test("rejected resume writes nothing", async () => {
    const { member, bank } = await seedFund();
    const fake = fakeText();
    fake.setResponses([{ toolCalls: [{ name: "record_contribution", input: proposeInput(member.id, bank.id) }] }]);

    const ctx = ctxFor();
    const threadId = `web-${adminSession.user.id}`;
    const conversationId = await ensureConversation(db, ctx, threadId);
    const paused = await collectGate(agentStream({ ctx, params: { messages: [{ id: "1", role: "user", content: "record it" }] }, adapter: fake, threadId, conversationId }));

    fake.appendResponses([{ text: "Understood — nothing was recorded." }]);
    const resumed = await collectGate(agentStream({
      ctx,
      params: {
        messages: paused.snapshotMessages as never,
        runId: "resume-run",
        parentRunId: paused.interruptedRunId,
        resume: [{ interruptId: paused.interruptId!, status: "resolved", payload: { approved: false } }] as never,
      },
      adapter: fake,
      threadId,
      conversationId,
    }));
    expect(resumed.text).toContain("nothing was recorded");
    expect(await db.contribution.count()).toBe(1); // seed only — zero writes
  });

  test("sanity caps reject before any card would appear", async () => {
    const { member, bank } = await seedFund();
    const caps = [
      proposeInput(member.id, bank.id, { amount: 0 }),
      proposeInput(member.id, bank.id, { amount: 10_000_001 }),
      proposeInput(member.id, bank.id, { amount: 5000.5 }),
      proposeInput(member.id, bank.id, { creditDate: "2027-01-31" }), // > 35 days future
    ];
    for (const [index, input] of caps.entries()) {
      const fake = fakeText();
      fake.setResponses([{ toolCalls: [{ name: "record_contribution", input }] }, { text: "cannot do that" }]);
      const ctx = ctxFor();
      const threadId = `web-${adminSession.user.id}`;
      const conversationId = await ensureConversation(db, ctx, threadId);
      const result = await collectGate(agentStream({ ctx, params: { messages: [{ id: "1", role: "user", content: "try it" }] }, adapter: fake, threadId, conversationId }));
      expect(result.interruptId).toBeUndefined(); // never reached a card
      expect(result.toolResults.some((r) => r.error !== undefined)).toBe(true);
      // The validation error goes back to the model so it self-corrects
      if (index === 0) {
        expect(result.toolResults.some((r) => String(r.error).includes("Amount must be at least"))).toBe(true);
      }
    }
    expect(await db.contribution.count()).toBe(1);
  });

  test("preview tool is ungated; record tool requires approval", () => {
    expect(previewContributionDef.needsApproval).toBeUndefined();
    expect(recordContributionDef.needsApproval).toBe(true);
  });
});
