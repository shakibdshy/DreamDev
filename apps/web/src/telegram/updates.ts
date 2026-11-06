import type { Database } from "@DreamDev/db";

import { bindChat, consumePairingCode } from "./pairing";
import type { TelegramClient } from "./client";

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
  `✅ Linked! ${name}, you're connected as ${role}.\n\nFund assistant chat on Telegram arrives shortly — you'll get a message here when it's live.`;

const PAIRING_INSTRUCTIONS = [
  "👋 This is the DreamDev fund bot.",
  "",
  "To connect, open the dashboard → Settings → “Connect Telegram”, then either:",
  "• tap the link you get there, or",
  "• send /start followed by your pairing code (e.g. /start AB12CD34).",
  "",
  "Codes come from the dashboard and expire in 15 minutes.",
].join("\n");

const LINK_TAKEN = "⚠️ This Telegram account is already linked to another dashboard account. Unlink it there first.";

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

export function createUpdateHandler(deps: { db: Database; client: TelegramClient; deduper?: UpdateDeduper }) {
  const deduper = deps.deduper ?? new UpdateDeduper();
  return async function handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!deduper.firstTime(update.update_id)) return;

    const message = update.message;
    if (!message) return; // callback_query handling arrives with ticket 6/8
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
        await deps.client.sendMessage(chatId, "⚠️ That code is invalid, already used, or expired. Generate a fresh one in the dashboard (Settings → Connect Telegram).");
        return;
      }
      try {
        await bindChat(deps.db, consumed, chatId);
      } catch {
        await deps.client.sendMessage(chatId, LINK_TAKEN);
        return;
      }
      const target = consumed.targetType === "user" ? await deps.db.user.findUnique({ where: { id: consumed.targetId } }) : null;
      await deps.client.sendMessage(chatId, WELCOME_USER(target?.name ?? "there", (target?.role ?? "editor") === "admin" ? "Admin" : "Editor"));
      return;
    }

    // Any other message: linked users get a placeholder, unknown chats instructions.
    const linked = await deps.db.user.findFirst({ where: { telegramChatId: chatId } });
    if (linked) {
      await deps.client.sendMessage(chatId, "The fund assistant on Telegram is coming soon — meanwhile the dashboard chat is live on every page.");
      return;
    }
    await deps.client.sendMessage(chatId, PAIRING_INSTRUCTIONS);
  };
}
