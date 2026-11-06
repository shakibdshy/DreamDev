import { chatParamsFromRequest, toServerSentEventsResponse, type AnyTextAdapter } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";

import type { Session } from "@DreamDev/auth";

import { ENV } from "@/env.server";

import { agentStream, createRateLimiter, ensureConversation, messageText, RateLimitError } from "./agent";
import type { AgentContext } from "./context";
import { errorResponse, HttpError, requireUser } from "../api/http";
import { appContext, withApi, type ApiResolver } from "../api/route-helpers";

/** HTTP surface for the fund agent: POST = one agent turn (SSE), GET = history. */

const DEFAULT_THREAD = (channel: string, userId: string) => `${channel}-${userId}`;

/** The GLM adapter from env; undefined = agent disabled (everything else works). */
export function envAgentAdapter(): AnyTextAdapter | undefined {
  if (!ENV.AGENT_API_KEY || !ENV.AGENT_BASE_URL) return undefined;
  return openaiCompatibleText(ENV.AGENT_MODEL || "glm-5.3-flash", {
    baseURL: ENV.AGENT_BASE_URL,
    apiKey: ENV.AGENT_API_KEY,
  });
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
        const conversationId = await ensureConversation(db, ctx, threadId);

        // Persist the new user message before streaming (resume turns add none).
        const last = params.messages.at(-1);
        if (last?.role === "user") {
          await db.agentMessage.create({
            data: { conversationId, role: "user", content: messageText(last) },
          });
        }

        const stream = agentStream({ ctx, params, adapter, threadId, conversationId });
        return toServerSentEventsResponse(stream);
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
