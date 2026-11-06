import { chat, maxIterations, type AnyTextAdapter, type ChatMiddleware } from "@tanstack/ai";

import type { Database } from "@DreamDev/db";

import { systemPrompt } from "./prompt";
import { agentTools } from "./tools";
import type { AgentContext } from "./context";

/**
 * The fund agent: one TanStack AI loop over read-only service tools
 * (ticket 3/8). The model never touches the database — every tool call goes
 * through the same services the dashboard routes use, and every conversation,
 * message, and tool call lands in the audit tables.
 */

export interface ChatParamsLike {
  messages: Parameters<typeof chat>[0]["messages"];
  runId?: string;
  parentRunId?: string | null;
  /** Interrupt answers from an approval (resume of a paused run). */
  resume?: Parameters<typeof chat>[0]["resume"];
}

/** Sliding-window rate limiter (~60 agent messages/hour per user, in-memory). */
export function createRateLimiter(limitPerHour: number) {
  const hits = new Map<string, number[]>();
  return {
    /** Throws when the user exceeded the window; records the hit otherwise. */
    check(userId: string, now = Date.now()) {
      const hourAgo = now - 3_600_000;
      const recent = (hits.get(userId) ?? []).filter((t) => t > hourAgo);
      if (recent.length >= limitPerHour) throw new RateLimitError(limitPerHour);
      recent.push(now);
      hits.set(userId, recent);
    },
  };
}

export class RateLimitError extends Error {
  constructor(public readonly limitPerHour: number) {
    super(`Agent rate limit exceeded (${limitPerHour} messages per hour). Try again later.`);
  }
}

const messageText = (message: { role: string; content?: unknown; parts?: unknown }): string => {
  if (typeof message.content === "string") return message.content;
  // UIMessage: parts carry the text ({type:'text', content}); ModelMessage content may be part arrays with text
  const parts = Array.isArray(message.parts) ? message.parts : Array.isArray(message.content) ? message.content : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: string; content?: unknown; text?: unknown };
      return p.type === "text" ? String(p.content ?? p.text ?? "") : "";
    })
    .join("");
};

/** Upserts the user's ongoing conversation row and returns its id. */
async function ensureConversation(db: Database, ctx: AgentContext, threadId: string): Promise<string> {
  const conversation = await db.agentConversation.upsert({
    where: { userId_threadId: { userId: ctx.session.user.id, threadId } },
    create: { userId: ctx.session.user.id, threadId, channel: ctx.channel },
    update: { channel: ctx.channel },
  });
  return conversation.id;
}

/** Builds the audit middleware — persists tool calls and the final answer. */
function auditMiddleware(conversationId: string, db: Database): ChatMiddleware<AgentContext> {
  return {
    name: "audit",
    onAfterToolCall: async (_ctx, info) => {
      await db.agentMessage.create({
        data: {
          conversationId,
          role: "tool",
          content: info.ok ? "" : String(info.error ?? "tool failed"),
          toolName: info.toolName,
          toolArgsJson: info.toolCall.function?.arguments ?? "{}",
          toolResultJson: info.ok ? JSON.stringify(info.result ?? null) : null,
        },
      });
    },
    onFinish: async (_ctx, info) => {
      if (!info.content) return;
      await db.agentMessage.create({ data: { conversationId, role: "assistant", content: info.content } });
    },
    onError: async (_ctx, info) => {
      await db.agentMessage.create({ data: { conversationId, role: "assistant", content: `[error] ${info.error}` } });
    },
  };
}

/**
 * Runs one agent turn and returns the SSE-able chunk stream. The caller is
 * responsible for auth, rate limiting, and the adapter; the agent loop,
 * system prompt, tools, and audit persisting live here.
 */
export function agentStream(args: {
  ctx: AgentContext;
  params: ChatParamsLike;
  adapter: AnyTextAdapter;
  threadId: string;
  /** Set by the caller before streaming — tool-call and answer audit hangs off it. */
  conversationId: string;
}) {
  const { ctx, params, adapter, threadId, conversationId } = args;
  return chat({
    adapter,
    messages: params.messages,
    threadId,
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    systemPrompts: [systemPrompt(ctx)],
    tools: agentTools(ctx.session.user.role === "admin" ? "admin" : "editor"),
    context: ctx,
    agentLoopStrategy: maxIterations(8),
    middleware: [auditMiddleware(conversationId, ctx.db)],
  });
}

export { ensureConversation, messageText };
