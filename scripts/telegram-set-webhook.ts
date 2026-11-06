/**
 * Registers the production Telegram webhook (ticket 8/8). Run once per
 * deployment origin:
 *
 *   bun scripts/telegram-set-webhook.ts https://your-app.vercel.app
 *
 * Reads TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET from apps/web/.env
 * (the same values varlock loads at runtime).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readEnv(key: string): string {
  const raw = readFileSync(join(import.meta.dir, "../apps/web/.env"), "utf8");
  const line = raw.split("\n").find((l) => l.trimStart().startsWith(`${key}=`));
  if (!line) throw new Error(`${key} missing from apps/web/.env`);
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (!value) throw new Error(`${key} is empty`);
  return value;
}

const origin = process.argv[2]?.replace(/\/$/, "");
if (!origin || !origin.startsWith("https://")) {
  console.error("Usage: bun scripts/telegram-set-webhook.ts https://<deployment-origin>");
  process.exit(1);
}

const token = readEnv("TELEGRAM_BOT_TOKEN");
const secret = readEnv("TELEGRAM_WEBHOOK_SECRET");
const url = `${origin}/api/telegram/webhook`;

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
});
const result = (await response.json()) as { ok: boolean; description?: string };
console.log(result.ok ? `✅ Webhook registered: ${url}` : `❌ setWebhook failed: ${result.description}`);
process.exit(result.ok ? 0 : 1);
