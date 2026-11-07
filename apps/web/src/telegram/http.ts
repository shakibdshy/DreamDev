import { timingSafeEqual } from "node:crypto";

import { optionalEnv } from "@/env-optional";
import { runAfterResponse } from "@/lib/background";

import { createTelegramClient, type TelegramClient } from "./client";
import { issuePairingCode, unlinkUser } from "./pairing";
import { envAgentAdapter } from "@/agent/http";
import type { AnyTextAdapter } from "@tanstack/ai";
import { createUpdateHandler, UpdateDeduper, type TelegramUpdate } from "./updates";
import { errorResponse, HttpError, requireUser } from "../api/http";
import { appContext, ok, withApi, type ApiResolver } from "../api/route-helpers";

/**
 * HTTP surface for Telegram (ticket 1/8): the webhook (secret-token verified,
 * replay-deduped) and pairing endpoints for the Settings page. All lazily
 * bound — varlock ENV must not be read at import time.
 */

const deduper = new UpdateDeduper();

function clientFromEnv(): TelegramClient | undefined {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  return token ? createTelegramClient(token) : undefined;
}

/** Constant-time secret comparison — fail closed on unset/missing/mismatched. */
export function verifyWebhookSecret(header: string | null, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TelegramApiOptions {
  client?: TelegramClient;
  /** Lazy adapter for the agent transport (tests inject fakeText). */
  getAdapter?: () => AnyTextAdapter | undefined;
}

export function telegramApi(resolve: ApiResolver, options: TelegramApiOptions = {}) {
  return {
    /** The single Telegram webhook. Always 200 on handled updates — Telegram retries non-2xx. */
    postWebhook: async ({ request }: { request: Request }) => {
      if (!optionalEnv("TELEGRAM_BOT_TOKEN")) return errorResponse(new HttpError(503, "Telegram bot not configured"));
      if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), optionalEnv("TELEGRAM_WEBHOOK_SECRET"))) {
        return ok({ received: false }, 401);
      }
      const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
      if (!update || typeof update.update_id !== "number") return ok({ received: false }); // nothing actionable
      const { db } = await resolve(request);
      const handle = createUpdateHandler({
        db,
        client: options.client ?? clientFromEnv()!,
        adapter: options.getAdapter?.() ?? envAgentAdapter(),
        deduper,
      });
      // Ack fast — the agent turn (several LLM hops) must not hold Telegram's
      // connection. waitUntil keeps the function alive until the reply is sent.
      await runAfterResponse(
        handle(update).catch((error) => {
          // Never signal failure to Telegram — redelivery would fight the deduper.
          console.error("Telegram update handling failed", error);
        }),
      );
      return ok({ received: true });
    },

    /** Issues a pairing code + deep link for the signed-in user. */
    postPair: withApi(async (ctx) => {
      const user = requireUser(ctx.session);
      if (!optionalEnv("TELEGRAM_BOT_TOKEN") || !optionalEnv("TELEGRAM_BOT_USERNAME")) {
        throw new HttpError(503, "Telegram bot not configured");
      }
      const issued = await issuePairingCode(ctx.db, { targetType: "user", targetId: user.id, createdBy: user.id });
      return {
        code: issued.code,
        expiresAt: issued.expiresAt.toISOString(),
        deepLink: issued.deepLink(optionalEnv("TELEGRAM_BOT_USERNAME")!),
      };
    }, resolve),

    /** Status for the Settings card. */
    getStatus: withApi(async (ctx) => {
      const user = requireUser(ctx.session);
      const fresh = await ctx.db.user.findUnique({ where: { id: user.id } });
      return {
        configured: Boolean(optionalEnv("TELEGRAM_BOT_TOKEN") && optionalEnv("TELEGRAM_BOT_USERNAME")),
        linked: Boolean(fresh?.telegramChatId),
        linkedAt: fresh?.telegramLinkedAt?.toISOString() ?? null,
      };
    }, resolve),

    /** Revokes the binding immediately. */
    postUnlink: withApi(async (ctx) => {
      const user = requireUser(ctx.session);
      await unlinkUser(ctx.db, user.id);
      return { linked: false };
    }, resolve),
  };
}

export const telegram = telegramApi(appContext);
