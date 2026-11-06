import type { Database } from "@DreamDev/db";

import { createTelegramClient, type TelegramClient, type TelegramSendResult } from "./client";
import { optionalEnv } from "@/env-optional";

/**
 * Member notifications (ticket 7/8): on every member-touching write — from
 * the dashboard OR the agent — the affected member (and only that member)
 * gets a templated DM. Records with no member notify nobody. Send failures
 * are logged and retried on the member's next touching write; they never
 * fail the write itself. Awaited rather than fire-and-forget: Vercel kills
 * unawaited work when the handler returns.
 */

export type MemberEventType =
  | "contribution_recorded"
  | "contribution_updated"
  | "contribution_deleted"
  | "loan_recorded"
  | "loan_deleted"
  | "repayment_recorded"
  | "adjustment_recorded"
  | "adjustment_updated"
  | "adjustment_deleted"
  | "shares_changed"
  | "status_changed";

export interface MemberEvent {
  memberId: string;
  type: MemberEventType;
  recordId: string;
}

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

const HEADINGS: Record<MemberEventType, string> = {
  contribution_recorded: "✅ Contribution recorded",
  contribution_updated: "✏️ Contribution updated",
  contribution_deleted: "🗑️ Contribution removed",
  loan_recorded: "💸 Loan recorded",
  loan_deleted: "🗑️ Loan removed",
  repayment_recorded: "✅ Loan repayment recorded",
  adjustment_recorded: "⚖️ Adjustment recorded",
  adjustment_updated: "✏️ Adjustment updated",
  adjustment_deleted: "🗑️ Adjustment removed",
  shares_changed: "📊 Share quantity changed",
  status_changed: "ℹ️ Membership status changed",
};

/** Builds the canonical message body from DB reads — the single template source. */
export async function buildNotificationBody(db: Database, event: MemberEvent): Promise<string> {
  const member = await db.member.findUnique({ where: { id: event.memberId } });
  const name = member?.name ?? "Member";
  const lines = [HEADINGS[event.type]];

  const bankLine = async (bankAccountId: string | null) => {
    if (!bankAccountId) return null;
    const bank = await db.bankAccount.findUnique({ where: { id: bankAccountId } });
    return bank ? `Bank account: ${bank.bankName}` : null;
  };

  switch (event.type) {
    case "contribution_recorded":
    case "contribution_updated":
    case "contribution_deleted": {
      const row = await db.contribution.findUnique({ where: { id: event.recordId } });
      if (!row) return `${lines[0]} — record no longer available.`;
      lines.push(`Amount: ${taka(row.amount)}`, `Credit Date: ${day(row.creditDate)}`);
      const bank = await bankLine(row.bankAccountId);
      if (bank) lines.push(bank);
      const position = await runningPosition(db, event.memberId);
      if (position) lines.push(position);
      break;
    }
    case "loan_recorded":
    case "loan_deleted": {
      const row = await db.loan.findUnique({ where: { id: event.recordId } });
      if (!row) return `${lines[0]} — record no longer available.`;
      lines.push(`Amount: ${taka(row.amount)}`, `Date: ${day(row.date)}`);
      const bank = await bankLine(row.bankAccountId);
      if (bank) lines.push(bank);
      lines.push(`Outstanding now: ${await outstandingOf(db, event.recordId)}`);
      break;
    }
    case "repayment_recorded": {
      const row = await db.loanRepayment.findUnique({ where: { id: event.recordId } });
      if (!row) return `${lines[0]} — record no longer available.`;
      lines.push(`Amount: ${taka(row.amount)}`, `Credit Date: ${day(row.creditDate)}`);
      const bank = await bankLine(row.bankAccountId);
      if (bank) lines.push(bank);
      lines.push(`Loan outstanding now: ${await outstandingOf(db, row.loanId)}`);
      break;
    }
    case "adjustment_recorded":
    case "adjustment_updated":
    case "adjustment_deleted": {
      const row = await db.adjustment.findUnique({ where: { id: event.recordId } });
      if (!row) return `${lines[0]} — record no longer available.`;
      lines.push(`Amount: ${taka(row.amount)}`, ...(row.month ? [`Month: ${row.month}`] : []), `Reason: ${row.reason}`);
      const position = await runningPosition(db, event.memberId);
      if (position) lines.push(position);
      break;
    }
    case "shares_changed": {
      const row = await db.shareAllotment.findFirst({ where: { memberId: event.memberId }, orderBy: { effectiveMonth: "desc" } });
      const monthlyBill = row ? row.quantity * (await currentPrice(db)) : null;
      lines.push(`New quantity: ${row?.quantity ?? "?"} share(s)`);
      if (monthlyBill) lines.push(`Monthly bill now: ${taka(monthlyBill)}`);
      break;
    }
    case "status_changed": {
      const change = await db.memberStatusChange.findFirst({ where: { memberId: event.memberId }, orderBy: { date: "desc" } });
      lines.push(`Status: ${change?.status ?? member?.status ?? "?"}`, ...(change?.date ? [`Effective: ${day(change.date)}`] : []));
      break;
    }
  }

  lines.push("", `— DreamDev fund bot (for ${name})`);
  return lines.filter(Boolean).join("\n");
}

async function currentPrice(db: Database): Promise<number> {
  const latest = await db.sharePriceEntry.findFirst({ orderBy: { effectiveMonth: "desc" } });
  return latest?.price ?? 5000;
}

/** "Due: ৳X" or "Advance: ৳Y" — computed with the fund's own domain math. */
async function runningPosition(db: Database, memberId: string): Promise<string | null> {
  const { memberFacts, getPriceEntries } = await import("@/api/members/billing-facts");
  const { dueSummary } = await import("@DreamDev/db/domain/due");
  const { monthOfDate } = await import("@DreamDev/db/domain/month");
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) return null;
  const [allotments, statusChanges, prices, contributions, adjustments] = await Promise.all([
    db.shareAllotment.findMany({ where: { memberId }, orderBy: { effectiveMonth: "asc" } }),
    db.memberStatusChange.findMany({ where: { memberId } }),
    await getPriceEntries(db),
    db.contribution.findMany({ where: { memberId, deletedAt: null } }),
    db.adjustment.findMany({ where: { memberId, deletedAt: null } }),
  ]);
  const facts = memberFacts(member, allotments, prices, statusChanges);
  const entries = [
    ...contributions.map((c) => ({ date: day(c.creditDate), amount: c.amount, kind: "contribution" as const })),
    ...adjustments.map((a) => ({ date: day(a.createdAt), amount: a.amount, kind: "adjustment" as const })),
  ];
  const summary = dueSummary(facts, entries, monthOfDate(new Date()));
  return summary.due > 0 ? `Your Due: ${taka(summary.due)}` : summary.advance > 0 ? `Your Advance: ${taka(summary.advance)}` : "You are settled";
}

async function outstandingOf(db: Database, loanId: string): Promise<string> {
  const loan = await db.loan.findUnique({ where: { id: loanId } });
  if (!loan) return "unknown";
  const repaid = await db.loanRepayment.aggregate({ _sum: { amount: true }, where: { loanId, deletedAt: null } });
  return taka(Math.max(0, loan.amount - (repaid._sum.amount ?? 0)));
}

/** The production sender; optionalEnv keeps it inert under plain bun test. */
function clientFromEnv(): TelegramClient | undefined {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  return token ? createTelegramClient(token) : undefined;
}

/**
 * The client the service-layer hooks send through. Initialized from env at
 * module load (undefined under plain bun test — events log skipped) and
 * replaceable in tests via setActiveTelegramClient.
 */
let activeClient: TelegramClient | undefined = clientFromEnv();

export function setActiveTelegramClient(client: TelegramClient | undefined): void {
  activeClient = client;
}

export interface NotifyDeps {
  db: Database;
  client?: TelegramClient;
}

/**
 * Emits one member notification. Logs every outcome; retries this member's
 * failed sends first. Catches everything — callers may await it safely.
 */
export async function notifyMemberEvent(deps: NotifyDeps, event: MemberEvent): Promise<void> {
  const { db } = deps;
  const client = deps.client ?? activeClient;
  try {
    await retryFailedFor(db, client, event.memberId);
    await deliver(db, client, event);
  } catch (error) {
    console.error("notifyMemberEvent failed", error);
  }
}

async function deliver(db: Database, client: TelegramClient | undefined, event: MemberEvent): Promise<void> {
  // Dedupe: the unique row is the tombstone — a second identical event is a no-op.
  const existing = await db.notificationLog.findUnique({
    where: { recordId_type_memberId: { recordId: event.recordId, type: event.type, memberId: event.memberId } },
  });
  if (existing && existing.status !== "failed") return;

  const member = await db.member.findUnique({ where: { id: event.memberId } });
  if (!member) return;

  if (!member.notifyEnabled) {
    await upsertLog(db, event, "disabled", "");
    return;
  }
  if (!member.telegramChatId) {
    await upsertLog(db, event, "skipped-no-chat", "");
    return;
  }
  if (!client) {
    // Bot not configured — the event is recorded but not failed; it never retries.
    await upsertLog(db, event, "skipped-no-chat", "bot not configured");
    return;
  }

  const content = await buildNotificationBody(db, event);
  const result: TelegramSendResult = await client.sendMessage(member.telegramChatId, content);
  if (result.ok) {
    await upsertLog(db, event, "sent", content, result.messageId);
  } else {
    await upsertLog(db, event, "failed", content, undefined, result.description);
  }
}

/** Re-sends this member's failed notifications (oldest first), same content. */
async function retryFailedFor(db: Database, client: TelegramClient | undefined, memberId: string): Promise<void> {
  if (!client) return;
  const failed = await db.notificationLog.findMany({ where: { memberId, status: "failed" }, orderBy: { createdAt: "asc" }, take: 5 });
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member?.telegramChatId) return;
  for (const row of failed) {
    const result = await client.sendMessage(member.telegramChatId, row.content);
    await db.notificationLog.update({
      where: { id: row.id },
      data: { status: result.ok ? "sent" : "failed", telegramMessageId: result.ok ? result.messageId : null, error: result.ok ? null : result.description, retriedAt: new Date() },
    });
    if (!result.ok) break; // Telegram likely down — don't hammer
  }
}

async function upsertLog(db: Database, event: MemberEvent, status: string, content: string, messageId?: number, error?: string): Promise<void> {
  const key = { recordId_type_memberId: { recordId: event.recordId, type: event.type, memberId: event.memberId } };
  const existing = await db.notificationLog.findUnique({ where: key });
  if (existing) {
    await db.notificationLog.update({
      where: { id: existing.id },
      data: { status, content, telegramMessageId: messageId ?? null, error: error ?? null },
    });
    return;
  }
  await db.notificationLog.create({
    data: { memberId: event.memberId, type: event.type, recordId: event.recordId, status, content, telegramMessageId: messageId ?? null, error: error ?? null },
  });
}
