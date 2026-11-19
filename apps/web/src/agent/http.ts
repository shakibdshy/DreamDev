import { chatParamsFromRequest, toServerSentEventsResponse, type AnyTextAdapter } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";

import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

import { optionalEnv } from "@/env-optional";

import { agentStream, createRateLimiter, ensureConversation, messageText, RateLimitError } from "./agent";
import type { AgentContext } from "./context";
import { errorResponse, HttpError, requireUser } from "../api/http";
import { appContext, withApi, type ApiResolver } from "../api/route-helpers";

/** HTTP surface for the fund agent: POST = one agent turn (SSE), GET = history. */

const DEFAULT_THREAD = (channel: string, userId: string) => `${channel}-${userId}`;

const APPROVAL_TTL_MINUTES = 10;

/** Chunk shapes the pause persistence reads — mirrors runTurn in the TG bridge. */
type InterruptChunk = {
  type: string;
  messages?: unknown[];
  outcome?: {
    type: string;
    interrupts?: { metadata?: Record<string, { interruptedRunId: string; interruptId: string; toolName: string; originalArgs: unknown } | undefined> }[];
  };
};

/**
 * Intercepts the turn's chunk stream and persists a paused approval BEFORE the
 * client sees RUN_FINISHED (#23): the row always exists by the time Approve can
 * be clicked, and the resume executes from this server-held snapshot instead of
 * the client's wire copy.
 */
async function* persistingPauses<T>(db: Database, userId: string, threadId: string, stream: AsyncIterable<T>): AsyncGenerator<T> {
  let snapshot: unknown[] = [];
  for await (const raw of stream) {
    const chunk = raw as InterruptChunk;
    if (chunk.type === "MESSAGES_SNAPSHOT" && Array.isArray(chunk.messages)) snapshot = chunk.messages;
    if (chunk.type === "RUN_FINISHED" && chunk.outcome?.type === "interrupt") {
      const binding = chunk.outcome.interrupts?.[0]?.metadata?.["tanstack:interruptBinding"];
      if (binding) {
        const data = {
          userId,
          threadId,
          interruptId: binding.interruptId,
          interruptedRunId: binding.interruptedRunId,
          toolName: binding.toolName,
          argsJson: JSON.stringify(binding.originalArgs ?? {}),
          messagesJson: JSON.stringify(snapshot),
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MINUTES * 60_000),
        };
        await db.agentPausedApproval.upsert({
          where: { threadId_interruptId: { threadId, interruptId: binding.interruptId } },
          create: data,
          update: { interruptedRunId: data.interruptedRunId, argsJson: data.argsJson, messagesJson: data.messagesJson, expiresAt: data.expiresAt },
        });
      }
    }
    yield raw;
  }
}

/** The GLM adapter from env; undefined = agent disabled (everything else works). */
export function envAgentAdapter(): AnyTextAdapter | undefined {
  const apiKey = optionalEnv("AGENT_API_KEY");
  const baseURL = optionalEnv("AGENT_BASE_URL");
  if (!apiKey || !baseURL) return undefined;
  return openaiCompatibleText(optionalEnv("AGENT_MODEL") || "glm-5.3-flash", { baseURL, apiKey });
}

export interface AgentApiOptions {
  /** Fixed adapter (tests). Takes precedence over getAdapter. */
  adapter?: AnyTextAdapter;
  /** Lazy adapter factory (production — varlock ENV must not be read at import time). */
  getAdapter?: () => AnyTextAdapter | undefined;
  rateLimitPerHour?: number;
}

export function agentApi(resolve: ApiResolver, options: AgentApiOptions = {}) {
  const limiter = createRateLimiter(options.rateLimitPerHour ?? 60);

  return {
    /** One agent turn: streams SSE chunks back to the chat panel. */
    postChat: async ({ request }: { request: Request }) => {
      try {
        const { db, session } = await resolve(request);
        const user = requireUser(session);
        const adapter = options.adapter ?? options.getAdapter?.();
        if (!adapter) throw new HttpError(503, "Agent unavailable — no model key configured");
        const params = await chatParamsFromRequest(request).catch(() => {
          throw new HttpError(422, "Invalid chat request");
        });

        const ctx: AgentContext = { db, session: session as Session, channel: "web" };
        limiter.check(user.id);

        const threadId = DEFAULT_THREAD(ctx.channel, user.id);

        // Consume the paused approval before anything runs — the atomic claim
        // (#23). deleteMany is the gate: a replayed resume loses the race and
        // 409s instead of executing the write a second time. The executed
        // replay comes from the server-held snapshot; the wire copy of the
        // messages (and any parentRunId it claims) is advisory only.
        const resumeInterruptId = (params.resume as { interruptId?: string }[] | undefined)?.[0]?.interruptId;
        if (resumeInterruptId) {
          const row = await db.agentPausedApproval.findUnique({ where: { threadId_interruptId: { threadId, interruptId: resumeInterruptId } } });
          let claimed: typeof row | null = null;
          if (row) {
            const result = await db.agentPausedApproval.deleteMany({ where: { id: row.id, expiresAt: { gt: new Date() } } });
            if (result.count === 1) claimed = row; // the delete IS the claim — a replay loses this race
          }
          if (!claimed) throw new HttpError(409, "That confirmation was already handled or expired.");
          params.messages = JSON.parse(claimed.messagesJson) as typeof params.messages;
          params.parentRunId = claimed.interruptedRunId;
        }

        const conversationId = await ensureConversation(db, ctx, threadId);

        // Persist the new user message before streaming (resume turns add none).
        const last = params.messages.at(-1);
        if (last?.role === "user") {
          await db.agentMessage.create({
            data: { conversationId, role: "user", content: messageText(last) },
          });
        }

        const stream = await agentStream({ ctx, params, adapter, threadId, conversationId });
        return toServerSentEventsResponse(persistingPauses(db, user.id, threadId, stream));
      } catch (error) {
        if (error instanceof RateLimitError) return errorResponse(new HttpError(429, error.message));
        return errorResponse(error);
      }
    },

    /** The conversation so far, oldest first, shaped for the panel's initialMessages. */
    getHistory: withApi(async (ctx) => {
      const user = requireUser(ctx.session);
      const conversation = await ctx.db.agentConversation.findUnique({
        where: { userId_threadId: { userId: user.id, threadId: DEFAULT_THREAD("web", user.id) } },
      });
      if (!conversation) return { messages: [] };
      const rows = await ctx.db.agentMessage.findMany({
        where: { conversationId: conversation.id, role: { not: "tool" } },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      return {
        messages: rows.map((row) => ({
          id: row.id,
          role: row.role as "user" | "assistant",
          parts: [{ type: "text" as const, content: row.content }],
        })),
      };
    }, resolve),
  };
}

export const agent = agentApi(appContext, { getAdapter: envAgentAdapter });
