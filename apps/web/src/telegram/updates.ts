import type { Database } from "@DreamDev/db";

import type { AnyTextAdapter } from "@tanstack/ai";

import { bindChat, consumePairingCode } from "./pairing";
import { HttpError } from "../api/http";
import type { TelegramClient } from "./client";
import { handleAgentMessage, handleApprovalCallback } from "./agent-bridge";

/**
 * Handles one Telegram update (ticket 1/8): pairing via /start <code>,
 * pairing instructions for unknown chats, and a placeholder reply for linked
 * users until the agent transport lands (ticket 6/8). Update ids are deduped
 * so Telegram's redeliveries never process twice.
 */

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number | string };
    text?: string;
    from?: { first_name?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number | string };
    data?: string;
  };
}

const WELCOME_USER = (name: string, role: string) =>
  `✅ Linked! ${name}, you're connected as ${role}.\n\nAsk me anything about the fund — every write shows a ✅/✖ confirm first.`;

const PAIRING_INSTRUCTIONS = [
  "👋 This is the DreamDev fund bot.",
  "",
  "To connect, open the dashboard → Settings → “Connect Telegram”, then either:",
  "• tap the link you get there, or",
  "• send /start followed by your pairing code (e.g. /start AB12CD34).",
  "",
  "Codes come from the dashboard and expire in 15 minutes.",
].join("\n");

const LINK_TAKEN = "⚠️ This Telegram account is already linked to another account. Unlink it first.";

const MEMBER_WELCOME = "✅ Linked! You'll receive notifications about your fund records here.\n\nThis bot is notification-only — it can't reply to questions or commands.";

const NOTIFICATION_ONLY = "This bot is notification-only. You'll receive messages about your fund records here, but it can't answer messages.";

export class UpdateDeduper {
  private seen = new Set<number>();
  constructor(private readonly capacity = 1000) {}
  /** True the first time an update id is observed. */
  firstTime(updateId: number): boolean {
    if (this.seen.has(updateId)) return false;
    if (this.seen.size >= this.capacity) this.seen.clear(); // coarse recycle — fine for one team's volume
    this.seen.add(updateId);
    return true;
  }
}

export function createUpdateHandler(deps: { db: Database; client: TelegramClient; adapter?: AnyTextAdapter; deduper?: UpdateDeduper }) {
  const deduper = deps.deduper ?? new UpdateDeduper();
  return async function handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!deduper.firstTime(update.update_id)) return;

    // Approve/Cancel buttons resume a paused confirm (ticket 6/8)
    if (update.callback_query) {
      const approved = update.callback_query.data === "approval:approve";
      await handleApprovalCallback(deps, String(update.callback_query.from.id), update.callback_query.id, approved);
      return;
    }

    const message = update.message;
    if (!message) return;
    const chatId = String(message.chat.id);
    const text = (message.text ?? "").trim();

    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1];
      if (!code) {
        await deps.client.sendMessage(chatId, PAIRING_INSTRUCTIONS);
        return;
      }
      const consumed = await consumePairingCode(deps.db, code.toUpperCase());
      if (!consumed) {
        await deps.client.sendMessage(chatId, "⚠️ That code is invalid, already used, or expired. Ask for a fresh code.");
        return;
      }
      try {
        await bindChat(deps.db, consumed, chatId);
      } catch (error) {
        const taken = error instanceof HttpError && error.status === 409;
        await deps.client.sendMessage(chatId, taken ? LINK_TAKEN : "⚠️ That code points to an account that no longer exists. Ask for a fresh code.");
        return;
      }
      if (consumed.targetType === "member") {
        await deps.client.sendMessage(chatId, MEMBER_WELCOME);
        return;
      }
      const user = await deps.db.user.findUnique({ where: { id: consumed.targetId } });
      await deps.client.sendMessage(chatId, WELCOME_USER(user?.name ?? "there", user?.role === "admin" ? "Admin" : "Editor"));
      return;
    }

    // Any other message: members are notification-only, linked users get the
    // agent loop, unknown chats pairing instructions.
    const member = await deps.db.member.findFirst({ where: { telegramChatId: chatId } });
    if (member) {
      await deps.client.sendMessage(chatId, NOTIFICATION_ONLY);
      return;
    }
    const linked = await deps.db.user.findFirst({ where: { telegramChatId: chatId } });
    if (linked) {
      await handleAgentMessage(deps, chatId, text, linked);
      return;
    }
    await deps.client.sendMessage(chatId, PAIRING_INSTRUCTIONS);
  };
}
