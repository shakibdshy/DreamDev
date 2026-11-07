import { chat, maxIterations, type AnyTextAdapter, type ChatMiddleware } from "@tanstack/ai";

import type { Database } from "@DreamDev/db";

import { listBanks } from "@/api/banks/service";
import { listMembers } from "@/api/members/service";

import { systemPrompt } from "./prompt";
import { agentTools } from "./tools";
import { serviceDeps, type AgentContext } from "./context";

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

/** Stable JSON for comparing tool arguments across preview/write calls. */
function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return JSON.stringify(value.map(stableJson));
  const sorted = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stableJson(v)]);
  return JSON.stringify(sorted);
}

const PREVIEW_OF: Record<string, string> = {
  record_contribution: "preview_contribution",
  write_record: "preview_write",
  delete_record: "preview_delete",
};

/** Arg-keys of preview calls that already produced results in the given history. */
function completedPreviewKeys(messages: ChatParamsLike["messages"]): Set<string> {
  const calls = new Map<string, { name: string; args: string }>();
  const answered = new Set<string>();
  // AG-UI ToolCall nests name/arguments under .function; synthesized history may carry them flat.
  type WireCall = { id?: string; name?: string; arguments?: string; function?: { name?: string; arguments?: string } };
  for (const message of messages as { role?: string; toolCalls?: WireCall[]; toolCallId?: string }[]) {
    if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) {
        const name = call.function?.name ?? call.name;
        const args = call.function?.arguments ?? call.arguments;
        if (call.id && name) calls.set(call.id, { name, args: args ?? "{}" });
      }
    }
    if (message.role === "tool" && typeof message.toolCallId === "string") answered.add(message.toolCallId);
  }
  const keys = new Set<string>();
  for (const [id, call] of calls) {
    if (!answered.has(id)) continue;
    if (Object.values(PREVIEW_OF).includes(call.name)) {
      try {
        keys.add(`${call.name}:${stableJson(JSON.parse(call.args))}`);
      } catch {
        /* unparseable args can't match anyway */
      }
    }
  }
  return keys;
}

/**
 * Confirm-gate precondition (hard rule, not prompt discipline): a gated write
 * only runs when its EXACT arguments were already previewed in this thread.
 * Skipped calls return a corrective error to the model, which then previews.
 */
function previewGateMiddleware(historyMessages: ChatParamsLike["messages"]): ChatMiddleware<AgentContext> {
  const seen = completedPreviewKeys(historyMessages);
  return {
    name: "preview-gate",
    onBeforeToolCall: (_ctx, info) => {
      const previewTool = PREVIEW_OF[info.toolName];
      if (!previewTool) return;
      let args: unknown = info.args;
      const key = `${previewTool}:${stableJson(args)}`;
      if (seen.has(key)) return;
      return {
        type: "skip",
        result: { error: `Call ${previewTool} with these exact arguments first and show the user its result — the confirm card requires the canonical preview.` },
      } as const;
    },
    onAfterToolCall: (_ctx, info) => {
      // Previews that complete in THIS run unlock the matching write.
      const previewTool = Object.values(PREVIEW_OF).find((name) => name === info.toolName);
      if (previewTool && info.ok) {
        try {
          seen.add(`${previewTool}:${stableJson(JSON.parse(info.toolCall.function?.arguments ?? "{}"))}`);
        } catch {
          /* ignore */
        }
      }
    },
  };
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
export async function agentStream(args: {
  ctx: AgentContext;
  params: ChatParamsLike;
  adapter: AnyTextAdapter;
  threadId: string;
  /** Set by the caller before streaming — tool-call and answer audit hangs off it. */
  conversationId: string;
}) {
  const { ctx, params, adapter, threadId, conversationId } = args;
  // Id/name directory up front: the model resolves names without spending
  // LLM hops on list_members / list_banks before every write.
  const [members, banks] = await Promise.all([
    listMembers(serviceDeps(ctx), { page: 1, pageSize: 100 }),
    listBanks(serviceDeps(ctx), {}),
  ]);
  const directory = {
    members: members.data.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    banks: banks.data.map((b) => ({ id: b.id, name: b.bankName })),
  };
  return chat({
    adapter,
    messages: params.messages,
    threadId,
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    systemPrompts: [systemPrompt(ctx, directory)],
    tools: agentTools(ctx.session.user.role === "admin" ? "admin" : "editor"),
    context: ctx,
    agentLoopStrategy: maxIterations(8),
    // The gate guards FRESH proposals; a resume replays an already-approved,
    // args-frozen call — enforcement happened before the pause.
    middleware: params.resume
      ? [auditMiddleware(conversationId, ctx.db)]
      : [previewGateMiddleware(params.messages), auditMiddleware(conversationId, ctx.db)],
  });
}

export { ensureConversation, messageText };
