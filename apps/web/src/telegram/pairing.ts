import type { Database } from "@DreamDev/db";

import { HttpError } from "../api/http";

/**
 * Pairing codes bind a Telegram chat to a dashboard User (Admin/Editor) or a
 * Member (#14): a single-use code, 15-minute TTL, consumed by /start in the
 * bot. Deep links carry the code: t.me/<bot>?start=<code>.
 */

export type PairingTargetType = "user" | "member";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — read-aloud safe
const CODE_LENGTH = 8;
const CODE_TTL_MINUTES = 15;

export function generateCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export interface IssuedPairing {
  code: string;
  expiresAt: Date;
  /** https://t.me/<bot>?start=<code> — bot username without @. */
  deepLink: (botUsername: string) => string;
}

export async function issuePairingCode(
  db: Database,
  args: { targetType: PairingTargetType; targetId: string; createdBy?: string | null },
): Promise<IssuedPairing> {
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  // Collision is astronomically unlikely; retry once on the unique constraint.
  const code = generateCode();
  try {
    await db.telegramPairingCode.create({ data: { code, targetType: args.targetType, targetId: args.targetId, expiresAt, createdBy: args.createdBy ?? null } });
  } catch {
    const retry = generateCode();
    await db.telegramPairingCode.create({ data: { code: retry, targetType: args.targetType, targetId: args.targetId, expiresAt, createdBy: args.createdBy ?? null } });
    return { code: retry, expiresAt, deepLink: (bot) => `https://t.me/${bot}?start=${retry}` };
  }
  return { code, expiresAt, deepLink: (bot) => `https://t.me/${bot}?start=${code}` };
}

export interface ConsumedPairing {
  targetType: PairingTargetType;
  targetId: string;
}

/** Consumes a valid, unused, unexpired code — exactly once. Null when invalid. */
export async function consumePairingCode(db: Database, code: string): Promise<ConsumedPairing | null> {
  const row = await db.telegramPairingCode.findUnique({ where: { code } });
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  await db.telegramPairingCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return { targetType: row.targetType as PairingTargetType, targetId: row.targetId };
}

const chatTaken = new HttpError(409, "This Telegram chat is already linked to another account");

/** Binds a chat to the target User; one chat = one identity. (Member binding arrives with ticket 2/8.) */
export async function bindChat(db: Database, consumed: ConsumedPairing, chatId: string): Promise<"user"> {
  if (consumed.targetType !== "user") throw new HttpError(400, "This code is not a dashboard-user code");
  const user = await db.user.findUnique({ where: { id: consumed.targetId } });
  if (!user) throw new HttpError(404, "User not found");
  const linked = await db.user.findFirst({ where: { telegramChatId: chatId } });
  if (linked && linked.id !== user.id) throw chatTaken;
  await db.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkedAt: new Date() } });
  return "user";
}

export async function unlinkUser(db: Database, userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkedAt: null } });
}
