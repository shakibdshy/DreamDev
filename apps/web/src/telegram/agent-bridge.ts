import type { AnyTextAdapter } from "@tanstack/ai";

import type { Session } from "@DreamDev/auth";

import { agentStream, ensureConversation, RateLimitError, createRateLimiter } from "@/agent/agent";
import { contributionPreview } from "@/agent/tools";
import { previewDelete, previewWrite } from "@/agent/write-tools";
import type { TelegramClient } from "./client";

/**
 * The Telegram transport for the fund agent (ticket 6/8): linked users chat
 * with the same loop, tools, prompt, role scoping, rate limit, and audit as
 * the web panel. Confirm cards become inline keyboards; the callback resumes
 * the interrupt from the server-held pause (AgentPausedApproval, 10-min TTL).
 * Members never reach here — updates.ts answers them notification-only.
 */

const tgLimiter = createRateLimiter(60);
const APPROVAL_TTL_MINUTES = 10;

const APPROVE_LABEL = "✅ Approve";
const CANCEL_LABEL = "✖ Cancel";
const approvalKeyboard = {
  inline_keyboard: [
    [
      { text: APPROVE_LABEL, callback_data: "approval:approve" },
      { text: CANCEL_LABEL, callback_data: "approval:cancel" },
    ],
  ],
};

/** A minimal Session shaped from the linked user row (services read id/role/status). */
function sessionFromUser(user: { id: string; role: string; status: string }): Session {
  return {
    user: { id: user.id, role: user.role, status: user.status },
    session: { id: `tg-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  } as unknown as Session;
}

/** Consumes an agent chunk stream, returning the reply text and pause info. */
async function runTurn(stream: AsyncIterable<unknown>) {
  let text = "";
  let pause: { interruptId: string; interruptedRunId: string; toolName: string; argsJson: string; messages: unknown } | undefined;
  let snapshot: unknown[] = [];
  for await (const raw of stream) {
    const chunk = raw as {
      type: string;
      delta?: unknown;
      outcome?: {
        type: string;
        interrupts?: {
          id: string;
          metadata?: Record<string, { interruptedRunId: string; interruptId: string; toolName: string; originalArgs: unknown } | undefined>;
        }[];
      };
    };
    if (chunk.type === "TEXT_MESSAGE_CONTENT") text += String(chunk.delta ?? "");
    if (chunk.type === "MESSAGES_SNAPSHOT") snapshot = (raw as { messages: unknown[] }).messages;
    if (chunk.type === "RUN_FINISHED" && chunk.outcome?.type === "interrupt") {
      const first = chunk.outcome.interrupts?.[0];
      const binding = first?.metadata?.["tanstack:interruptBinding"];
      if (binding) {
        pause = {
          interruptId: binding.interruptId,
          interruptedRunId: binding.interruptedRunId,
          toolName: binding.toolName,
          argsJson: JSON.stringify(binding.originalArgs ?? {}),
          messages: snapshot,
        };
      }
    }
  }
  return { text, pause };
}

/** Keeps the "typing…" bubble alive while a turn runs (Telegram expires it after ~5s). */
async function withTyping<T>(client: TelegramClient, chatId: string, work: Promise<T>): Promise<T> {
  const tick = () => void client.sendChatAction(chatId);
  tick();
  const timer = setInterval(tick, 4_000);
  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}

/**
 * The conversation so far, oldest first, as wire messages. Tool rows become
 * synthetic assistant-toolCall + tool-result pairs so the preview gate can see
 * which writes were already previewed in earlier turns.
 */
async function historyMessages(db: import("@DreamDev/db").Database, userId: string, threadId: string, limit = 20) {
  const conversation = await db.agentConversation.findUnique({ where: { userId_threadId: { userId, threadId } } });
  if (!conversation) return [];
  const rows = await db.agentMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: limit * 2,
  });
  const messages: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row.role === "tool") {
      // Only preview rows matter (the confirm gate reads them); old read-tool
      // JSON would bloat every LLM hop without adding signal.
      if (!row.toolName?.startsWith("preview_")) continue;
      messages.push({ id: `${row.id}-call`, role: "assistant", content: "", toolCalls: [{ id: row.id, type: "function", function: { name: row.toolName ?? "", arguments: row.toolArgsJson ?? "{}" } }] });
      messages.push({ id: row.id, role: "tool", toolCallId: row.id, content: row.toolResultJson ?? row.content ?? "" });
    } else {
      messages.push({ id: row.id, role: row.role as "user" | "assistant", content: row.content });
    }
  }
  return messages;
}

export interface AgentBridgeDeps {
  db: import("@DreamDev/db").Database;
  client: TelegramClient;
  adapter?: AnyTextAdapter;
}

/** One Telegram agent turn for a linked user. Sends the reply (and keyboard). */
export async function handleAgentMessage(deps: AgentBridgeDeps, chatId: string, text: string, user: { id: string; role: string; status: string }): Promise<void> {
  const { db, client } = deps;
  if (!deps.adapter) {
    await client.sendMessage(chatId, "The fund assistant isn't configured on this deployment yet.");
    return;
  }

  const pending = await db.agentPausedApproval.findUnique({ where: { chatId } });
  if (pending) {
    await client.sendMessage(chatId, "There's a pending confirmation above — use ✅ Approve or ✖ Cancel first.");
    return;
  }

  try {
    tgLimiter.check(user.id);
  } catch (error) {
    await client.sendMessage(chatId, error instanceof RateLimitError ? error.message : "Rate limit reached.");
    return;
  }

  const session = sessionFromUser(user);
  const ctx = { db, session, channel: "telegram" as const };
  const threadId = `telegram-${user.id}`;
  const conversationId = await ensureConversation(db, ctx, threadId);
  const history = await historyMessages(db, user.id, threadId);
  const messages = [...history, { id: `tg-${Date.now()}`, role: "user" as const, content: text }];
  await db.agentMessage.create({ data: { conversationId, role: "user", content: text } });

  let reply: string;
  let pause: Awaited<ReturnType<typeof runTurn>>["pause"];
  try {
    ({ text: reply, pause } = await withTyping(
      client,
      chatId,
      runTurn(await agentStream({ ctx, params: { messages: messages as never }, adapter: deps.adapter, threadId, conversationId })),
    ));
  } catch (error) {
    console.error("Telegram agent turn failed", error);
    await client.sendMessage(chatId, "Something went wrong on my side — please try again.");
    return;
  }

  if (pause && pause.messages) {
    await db.agentPausedApproval.create({
      data: {
        chatId,
        userId: user.id,
        threadId,
        interruptId: pause.interruptId,
        interruptedRunId: pause.interruptedRunId,
        toolName: pause.toolName,
        argsJson: pause.argsJson,
        messagesJson: JSON.stringify(pause.messages),
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MINUTES * 60_000),
      },
    });
    // Guardrail 5: the card shows canonical values read from the DB, never the model's text.
    const label = pause.toolName === "delete_record" ? "Delete this record?" : pause.toolName === "record_contribution" ? "Record this contribution?" : "Apply this change?";
    const lines = await canonicalLines(db, session, user.role === "admin" ? "admin" : "editor", JSON.parse(pause.argsJson), pause.toolName);
    const body = lines ? [label, "", ...lines].join("\n") : `${label}\n\nReview it in the dashboard chat before approving if unsure.`;
    await client.sendMessage(chatId, body, { replyMarkup: approvalKeyboard });
    return;
  }

  await client.sendMessage(chatId, reply || "I couldn't complete that — please try again.");
}

/** Canonical preview lines for a paused call, computed from the DB — or null when unknown. */
async function canonicalLines(db: import("@DreamDev/db").Database, session: Session, role: "admin" | "editor", args: { entity?: string; action?: string; id?: string; args?: Record<string, unknown>; memberId?: string; bankAccountId?: string; amount?: number; creditDate?: string }, toolName: string): Promise<string[] | null> {
  try {
    if (toolName === "delete_record" && args.entity && args.id) {
      return (await previewDelete({ db, session }, role, { entity: args.entity as never, id: args.id })).lines;
    }
    if (toolName === "write_record" && args.entity && args.action) {
      return (await previewWrite({ db, session }, role, args as never)).lines;
    }
    if (toolName === "record_contribution" && args.memberId && args.bankAccountId && typeof args.amount === "number" && typeof args.creditDate === "string") {
      const preview = await contributionPreview({ db, session, memberId: args.memberId, bankAccountId: args.bankAccountId, amount: args.amount, creditDate: args.creditDate });
      return [`${preview.memberName}: ৳${preview.amount.toLocaleString("en-IN")}`, `Credit Date ${preview.creditDate} — ${preview.bankName}`, preview.dueAfter > 0 ? `Due after: ৳${preview.dueAfter.toLocaleString("en-IN")}` : preview.advanceAfter > 0 ? `Advance after: ৳${preview.advanceAfter.toLocaleString("en-IN")}` : "Settled after"];
    }
  } catch {
    return null;
  }
  return null;
}

/** ✅/✖ callback: resumes the paused run or reports expiry. */
export async function handleApprovalCallback(deps: AgentBridgeDeps, chatId: string, callbackQueryId: string, approved: boolean): Promise<void> {
  const { db, client } = deps;
  const pending = await db.agentPausedApproval.findUnique({ where: { chatId } });
  if (!pending) {
    await client.answerCallbackQuery(callbackQueryId, "No pending confirmation.");
    return;
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await db.agentPausedApproval.delete({ where: { id: pending.id } });
    await client.answerCallbackQuery(callbackQueryId, "Expired.");
    await client.sendMessage(chatId, "That confirmation expired — please ask again.");
    return;
  }

  const user = await db.user.findUnique({ where: { id: pending.userId } });
  if (!user) {
    await db.agentPausedApproval.delete({ where: { id: pending.id } });
    await client.answerCallbackQuery(callbackQueryId, "Account not found.");
    return;
  }

  // Ack the tap immediately (Telegram spins the button until answered) and
  // claim the pause so a double-tap can't execute the write twice.
  await client.answerCallbackQuery(callbackQueryId, approved ? "Approved." : "Cancelled.");
  await db.agentPausedApproval.delete({ where: { id: pending.id } });

  // A rejection needs no model hop — the outcome is known and canonical.
  if (!approved) {
    const conversationId = await ensureConversation(db, { db, session: sessionFromUser(user), channel: "telegram" }, pending.threadId);
    await db.agentMessage.create({ data: { conversationId, role: "assistant", content: "Cancelled — nothing was recorded." } });
    await client.sendMessage(chatId, "Cancelled — nothing was recorded.");
    return;
  }

  const session = sessionFromUser(user);
  const ctx = { db, session, channel: "telegram" as const };
  const snapshot = JSON.parse(pending.messagesJson);
  let reply: string;
  let pauseAgain: Awaited<ReturnType<typeof runTurn>>["pause"];
  try {
    ({ text: reply, pause: pauseAgain } = await withTyping(
      client,
      chatId,
      runTurn(
        await agentStream({
          ctx,
          params: {
            messages: snapshot as never,
            runId: `tg-resume-${Date.now()}`,
            parentRunId: pending.interruptedRunId,
            resume: [{ interruptId: pending.interruptId, status: "resolved", payload: { approved } }] as never,
          },
          adapter: deps.adapter!,
          threadId: pending.threadId,
          conversationId: (await ensureConversation(db, ctx, pending.threadId)),
        }),
      ),
    ));
  } catch (error) {
    console.error("Telegram approval resume failed", error);
    await client.sendMessage(chatId, "That didn't go through — please ask again.");
    return;
  }

  // The resume may itself pause on another gated call — re-arm the keyboard.
  if (pauseAgain && pauseAgain.messages) {
    await db.agentPausedApproval.create({
      data: {
        chatId,
        userId: user.id,
        threadId: pending.threadId,
        interruptId: pauseAgain.interruptId,
        interruptedRunId: pauseAgain.interruptedRunId,
        toolName: pauseAgain.toolName,
        argsJson: pauseAgain.argsJson,
        messagesJson: JSON.stringify(pauseAgain.messages),
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MINUTES * 60_000),
      },
    });
    const lines = await canonicalLines(db, session, user.role === "admin" ? "admin" : "editor", JSON.parse(pauseAgain.argsJson), pauseAgain.toolName);
    const label = pauseAgain.toolName === "delete_record" ? "Delete this record?" : pauseAgain.toolName === "record_contribution" ? "Record this contribution?" : "Apply this change?";
    await client.sendMessage(chatId, [label, ...(lines ? ["", ...lines] : [])].join("\n"), { replyMarkup: approvalKeyboard });
    return;
  }

  await client.sendMessage(chatId, reply || "Done.");
}
