/**
 * Minimal Telegram Bot API client (spec #14: raw fetch, no SDK). Every call
 * resolves — a failed send returns { ok: false } rather than throwing, so a
 * Telegram outage can never break a ledger write or an agent turn.
 */

export interface TelegramSendResult {
  ok: boolean;
  /** Set when Telegram accepted the message. */
  messageId?: number;
  description?: string;
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string, options?: { replyMarkup?: InlineKeyboard }): Promise<TelegramSendResult>;
  sendChatAction(chatId: string, action?: "typing"): Promise<{ ok: boolean; description?: string }>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<{ ok: boolean; description?: string }>;
  getMe(): Promise<{ ok: boolean; result?: { username?: string }; description?: string }>;
}

export interface TelegramApiCall {
  method: string;
  body: Record<string, unknown>;
}

/** The subset of Bot API methods the fund bot uses — injectable for tests. */
export function createTelegramClient(token: string, fetchImpl: typeof fetch = fetch): TelegramClient {
  const call = async (method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> => {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
      return { ok: json.ok === true, result: json.result, description: json.description };
    } catch (error) {
      return { ok: false, description: error instanceof Error ? error.message : "network error" };
    }
  };

  return {
    async sendMessage(chatId, text, options) {
      const result = await call("sendMessage", {
        chat_id: chatId,
        text,
        ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      });
      const messageId = (result.result as { message_id?: number } | undefined)?.message_id;
      return { ok: result.ok, messageId, description: result.description };
    },
    async sendChatAction(chatId, action = "typing") {
      const result = await call("sendChatAction", { chat_id: chatId, action });
      return { ok: result.ok, description: result.description };
    },
    async answerCallbackQuery(callbackQueryId, text) {
      const result = await call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
      return { ok: result.ok, description: result.description };
    },
    async getMe() {
      const result = await call("getMe", {});
      return { ok: result.ok, result: result.result as { username?: string } | undefined, description: result.description };
    },
  };
}
