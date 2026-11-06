import type { Session } from "@DreamDev/auth";

import { optionalEnv } from "@/env-optional";

import { HttpError, requireUser } from "../api/http";
import { issuePairingCode, setMemberNotify, unlinkMember } from "./pairing";

/**
 * Admin/Editor operations for a Member's receive-only Telegram channel
 * (ticket 2/8). Pairing and status are everyday member management
 * (Editor+Admin); unlink and the notify toggle are Admin-only.
 */

interface OpsDeps {
  db: import("@DreamDev/db").Database;
  session: Session | null;
}

const requireAdmin = (session: Session | null) => {
  const user = requireUser(session);
  if (user.role !== "admin") throw new HttpError(403, "Admin role required");
  return user;
};

async function requireMember(deps: OpsDeps, memberId: string) {
  const member = await deps.db.member.findUnique({ where: { id: memberId } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");
  return member;
}

/** Issues a single-use pairing code for the member and returns the deep link. */
export async function issueMemberPairing(deps: OpsDeps, memberId: string) {
  const user = requireUser(deps.session);
  const botUsername = optionalEnv("TELEGRAM_BOT_USERNAME");
  if (!optionalEnv("TELEGRAM_BOT_TOKEN") || !botUsername) throw new HttpError(503, "Telegram bot not configured");
  await requireMember(deps, memberId);
  const issued = await issuePairingCode(deps.db, { targetType: "member", targetId: memberId, createdBy: user.id });
  return { code: issued.code, expiresAt: issued.expiresAt.toISOString(), deepLink: issued.deepLink(botUsername) };
}

export async function memberTelegramStatus(deps: OpsDeps, memberId: string) {
  requireUser(deps.session);
  const member = await requireMember(deps, memberId);
  return {
    configured: Boolean(optionalEnv("TELEGRAM_BOT_TOKEN") && optionalEnv("TELEGRAM_BOT_USERNAME")),
    linked: Boolean(member.telegramChatId),
    linkedAt: member.telegramLinkedAt?.toISOString() ?? null,
    notifyEnabled: member.notifyEnabled,
  };
}

export async function unlinkMemberRoute(deps: OpsDeps, memberId: string) {
  const user = requireAdmin(deps.session);
  await unlinkMember(deps.db, memberId, user.id);
  return { linked: false };
}

export async function setMemberNotifyRoute(deps: OpsDeps, memberId: string, body: unknown) {
  const user = requireAdmin(deps.session);
  const enabled = body === true || body === "true" || (typeof body === "object" && body !== null && "notifyEnabled" in body && (body as { notifyEnabled: unknown }).notifyEnabled === true);
  await setMemberNotify(deps.db, memberId, enabled, user.id);
  return { notifyEnabled: enabled };
}
