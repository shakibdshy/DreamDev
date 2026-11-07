import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import type { Database } from "@DreamDev/db";

import { createBank, softDeleteBank, updateBank } from "@/api/banks/service";
import { createAdjustment, softDeleteAdjustment, updateAdjustment } from "@/api/ledger/adjustment";
import { createExpense, softDeleteExpense, updateExpense } from "@/api/ledger/expense";
import { createTransfer, softDeleteTransfer, updateTransfer } from "@/api/ledger/transfer";
import { createMember, changeShares, setStatus, softDeleteMember, updateMember } from "@/api/members/service";
import { createLoan, createRepayment, softDeleteLoan } from "@/api/loans/service";
import { softDeleteContribution, updateContribution } from "@/api/transactions/service";
import { todayInDhaka } from "@DreamDev/db/domain/month";
import { createBankBodySchema, updateBankBodySchema } from "@/api/banks/schema";
import { createAdjustmentBodySchema, updateAdjustmentBodySchema } from "@/api/ledger/adjustment";
import { createExpenseBodySchema, updateExpenseBodySchema } from "@/api/ledger/expense";
import { createTransferBodySchema, updateTransferBodySchema } from "@/api/ledger/transfer";
import { changeSharesBodySchema, createMemberBodySchema, setStatusBodySchema, updateMemberBodySchema } from "@/api/members/schema";
import { createLoanBodySchema, createRepaymentBodySchema } from "@/api/loans/schema";
import { updateContributionBodySchema } from "@/api/transactions/schema";
import { memberPosition } from "@/api/transactions/service";

import type { AgentContext } from "./context";

/**
 * The agent's generic gated write surface (ticket 5/8). Four tools cover every
 * domain: preview_write / write_record (needsApproval) for creates, updates,
 * member status and share changes, and preview_delete / delete_record
 * (needsApproval, echoing the record's human identifier) for soft deletes.
 * Every executor dispatches into the same services the dashboard routes call,
 * so zod validation, admin guards, snapshots, FIFO, and attribution apply
 * unchanged. Two registries exist — the editor's schema drops the admin-only
 * entities/actions (Adjustments, Share changes) entirely.
 */

export type WriteEntity = "loan" | "loan_repayment" | "expense" | "transfer" | "adjustment" | "member" | "bank" | "contribution";
export type WriteAction = "create" | "update" | "status" | "shares" | "repay";

const ADMIN_ENTITIES: WriteEntity[] = ["adjustment"];
const ADMIN_ACTIONS: WriteAction[] = ["shares"];

export function writeInputSchema(role: "admin" | "editor") {
  const entities = (["loan", "loan_repayment", "expense", "transfer", "adjustment", "member", "bank", "contribution"] as WriteEntity[]).filter(
    (e) => role === "admin" || !ADMIN_ENTITIES.includes(e),
  );
  const actions = (["create", "update", "status", "shares", "repay"] as WriteAction[]).filter(
    (a) => role === "admin" || !ADMIN_ACTIONS.includes(a),
  );
  return z.object({
    entity: z.enum(entities),
    action: z.enum(actions),
    /** Target record id — required for update/status/shares/repay. */
    id: z.string().optional(),
    /** The fields, exactly as the dashboard form would send them. */
    args: z.record(z.string(), z.unknown()),
  });
}

export type WriteInput = { entity: WriteEntity; action: WriteAction; id?: string; args: Record<string, unknown> };

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Models occasionally emit the literal string "null" (or null) for optional
 * text — strip it before the zod layer so notes stay absent instead of
 * storing the four characters "null" in the ledger.
 */
export function sanitizeOptionalText<T extends Record<string, unknown>>(args: T, keys: ("note" | "reason" | "address" | "accountNumber")[]): T {
  const cleaned = { ...args };
  for (const key of keys) {
    if (key in cleaned) {
      const value = cleaned[key];
      if (value === null || (typeof value === "string" && ["null", "none", "undefined", ""].includes(value.trim().toLowerCase()))) {
        delete cleaned[key];
      }
    }
  }
  return cleaned;
}

/** Guard: editors cannot touch admin-only entities/actions even via edited args. */
function assertRoleAllowed(role: "admin" | "editor", input: WriteInput): void {
  if (role === "admin") return;
  if (ADMIN_ENTITIES.includes(input.entity)) throw new Error("Adjustments are Admin-only");
  if (ADMIN_ACTIONS.includes(input.action)) throw new Error("Share changes are Admin-only");
}

/**
 * Models naturally say `loan` + `repay` for a Loan Repayment — accept that
 * phrasing as the canonical `loan_repayment:repay` instead of dead-ending in
 * the fallback error (which once read as "use the dashboard forms").
 */
function normalizeInput(input: WriteInput): WriteInput {
  return input.entity === "loan" && input.action === "repay" ? { ...input, entity: "loan_repayment" } : input;
}

const VALID_WRITES =
  "loan:create · loan_repayment:repay (alias loan:repay) · expense:create|update · transfer:create|update · adjustment:create|update (Admin) · member:create|update|status|shares (shares Admin) · bank:create|update · contribution:update. " +
  "Resolve ids with list_members / list_banks / list_loans / transactions_feed — feed entries carry id.";

const SANITY_MAX_AMOUNT = 10_000_000; // ৳1 crore — the spec's tool-layer cap

/**
 * Tool-layer sanity caps on top of the service zod (spec guardrail 6): money
 * creates are bounded and record dates can't be in the future (the domain rule
 * the ledgerDateSchema enforces at the boundary). Applied in both preview and
 * execute so a hostile proposal never reaches a confirm card.
 */
function assertSanity(input: WriteInput): void {
  const { amount, date, creditDate } = input.args as { amount?: unknown; date?: unknown; creditDate?: unknown };
  if (typeof amount === "number") {
    if (!Number.isInteger(amount) || amount <= 0 || amount > SANITY_MAX_AMOUNT) {
      throw new Error(`Amount must be whole taka between ৳1 and ৳${SANITY_MAX_AMOUNT.toLocaleString("en-IN")}`);
    }
  }
  const rawDate = typeof creditDate === "string" ? creditDate : typeof date === "string" ? date : undefined;
  if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate > todayInDhaka()) {
    throw new Error("Record dates can't be in the future — use today or earlier (Asia/Dhaka)");
  }
}

interface WriteDeps {
  db: Database;
  session: AgentContext["session"];
}

/** Canonical human-readable preview lines, assembled from DB reads only. */
export async function previewWrite(deps: WriteDeps, role: "admin" | "editor", input: WriteInput): Promise<{ lines: string[] }> {
  assertRoleAllowed(role, input);
  assertSanity(input);
  input = normalizeInput(input);
  input = { ...input, args: sanitizeOptionalText(input.args, ["note", "reason", "address", "accountNumber"]) };
  const { db, session } = deps;
  const s = { db, session };
  const { entity, action, id, args } = input;

  const memberName = async (memberId: string) => (await db.member.findUnique({ where: { id: memberId } }))?.name ?? memberId;
  const bankName = async (bankId: string) => (await db.bankAccount.findUnique({ where: { id: bankId } }))?.bankName ?? bankId;

  switch (`${entity}:${action}`) {
    case "loan:create": {
      const parsed = createLoanBodySchema.parse(args);
      return { lines: [`Loan (interest-free): ${taka(parsed.amount)} to ${await memberName(parsed.memberId)}`, `from ${await bankName(parsed.bankAccountId)} on ${parsed.date}`, ...(parsed.note ? [`Note: ${parsed.note}`] : [])] };
    }
    case "loan_repayment:repay": {
      if (!id) throw new Error("A loan id is required to record a repayment");
      const parsed = createRepaymentBodySchema.parse(args);
      const loan = await db.loan.findUnique({ where: { id } });
      if (!loan || loan.deletedAt) throw new Error("Loan not found");
      const repaid = await db.loanRepayment.aggregate({ _sum: { amount: true }, where: { loanId: id, deletedAt: null } });
      const outstanding = loan.amount - (repaid._sum.amount ?? 0);
      return {
        lines: [
          `Loan repayment: ${taka(parsed.amount)} from ${await memberName(loan.memberId)}`,
          `loan of ${taka(loan.amount)} from ${day(loan.date)} — outstanding ${taka(outstanding)}`,
          `→ ${await bankName(parsed.bankAccountId)} on ${parsed.creditDate}`,
          `Outstanding after: ${taka(Math.max(0, outstanding - parsed.amount))}${outstanding - parsed.amount === 0 ? " (loan settles)" : ""}`,
        ],
      };
    }
    case "expense:create": {
      const parsed = createExpenseBodySchema.parse(args);
      return { lines: [`Expense: ${taka(parsed.amount)} from ${await bankName(parsed.bankAccountId)} on ${parsed.date}`, ...(parsed.note ? [`Note: ${parsed.note}`] : [])] };
    }
    case "expense:update": {
      if (!id) throw new Error("An expense id is required to update");
      const parsed = updateExpenseBodySchema.parse(args);
      const expense = await db.expense.findUnique({ where: { id } });
      if (!expense || expense.deletedAt) throw new Error("Expense not found");
      return { lines: [`Update expense of ${taka(expense.amount)} (${day(expense.date)})`, ...Object.entries(parsed).map(([k, v]) => `${k} → ${String(v)}`)] };
    }
    case "transfer:create": {
      const parsed = createTransferBodySchema.parse(args);
      return { lines: [`Transfer: ${taka(parsed.amount)}`, `${await bankName(parsed.fromAccountId)} → ${await bankName(parsed.toAccountId)} on ${parsed.date}`, ...(parsed.note ? [`Note: ${parsed.note}`] : [])] };
    }
    case "transfer:update": {
      if (!id) throw new Error("A transfer id is required to update");
      const parsed = updateTransferBodySchema.parse(args);
      const transfer = await db.transfer.findUnique({ where: { id } });
      if (!transfer || transfer.deletedAt) throw new Error("Transfer not found");
      return { lines: [`Update transfer of ${taka(transfer.amount)} (${day(transfer.date)})`, ...Object.entries(parsed).map(([k, v]) => `${k} → ${String(v)}`)] };
    }
    case "adjustment:create": {
      const parsed = createAdjustmentBodySchema.parse(args);
      return { lines: [`Adjustment (Admin): ${taka(parsed.amount)} for ${await memberName(parsed.memberId)}`, ...(parsed.month ? [`Month: ${parsed.month}`] : []), `Reason: ${parsed.reason}`] };
    }
    case "adjustment:update": {
      if (!id) throw new Error("An adjustment id is required to update");
      const parsed = updateAdjustmentBodySchema.parse(args);
      const adjustment = await db.adjustment.findUnique({ where: { id } });
      if (!adjustment || adjustment.deletedAt) throw new Error("Adjustment not found");
      return { lines: [`Update adjustment of ${taka(adjustment.amount)} for ${await memberName(adjustment.memberId)}`, ...Object.entries(parsed).map(([k, v]) => `${k} → ${String(v)}`)] };
    }
    case "member:create": {
      const parsed = createMemberBodySchema.parse(args);
      return { lines: [`New member: ${parsed.name} (${parsed.mobile})`, `Joining ${parsed.joiningDate} with ${parsed.shareQuantity} share(s)`] };
    }
    case "member:update": {
      if (!id) throw new Error("A member id is required to update");
      const parsed = updateMemberBodySchema.parse(args);
      return { lines: [`Update ${await memberName(id)}`, ...Object.entries(parsed).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} → ${String(v)}`)] };
    }
    case "member:status": {
      if (!id) throw new Error("A member id is required to change status");
      const parsed = setStatusBodySchema.parse(args);
      return { lines: [`Set ${await memberName(id)} → ${parsed.status}`, `Effective ${parsed.date}${parsed.note ? ` — ${parsed.note}` : ""}`] };
    }
    case "member:shares": {
      if (!id) throw new Error("A member id is required to change shares");
      const parsed = changeSharesBodySchema.parse(args);
      const position = await memberPosition(s, id);
      return { lines: [`Change shares for ${position.name}: ${position.shares} → ${parsed.quantity}`, `Effective ${parsed.effectiveMonth ?? "current month"} at ${taka(position.sharePrice)}/share`], };
    }
    case "bank:create": {
      const parsed = createBankBodySchema.parse(args);
      return { lines: [`New bank account: ${parsed.bankName}`, ...(parsed.accountNumber ? [`Account ${parsed.accountNumber}`] : []), `Opening balance ${taka(parsed.openingBalance ?? 0)}`] };
    }
    case "bank:update": {
      if (!id) throw new Error("A bank account id is required to update");
      const parsed = updateBankBodySchema.parse(args);
      const bank = await db.bankAccount.findUnique({ where: { id } });
      if (!bank || bank.deletedAt) throw new Error("Bank Account not found");
      return { lines: [`Update ${bank.bankName}`, ...Object.entries(parsed).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} → ${String(v)}`)] };
    }
    case "contribution:update": {
      if (!id) throw new Error("A contribution id is required to update");
      const parsed = updateContributionBodySchema.parse(args);
      const contribution = await db.contribution.findUnique({ where: { id } });
      if (!contribution || contribution.deletedAt) throw new Error("Contribution not found");
      return { lines: [`Update contribution: ${taka(contribution.amount)} from ${await memberName(contribution.memberId)} (${day(contribution.creditDate)})`, ...Object.entries(parsed).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} → ${String(v)}`)] };
    }
    default:
      throw new Error(`${entity} ${action} is not a valid write through chat. Valid writes: ${VALID_WRITES}`);
  }
}

/** Dispatches an approved write into the real service. */
export async function executeWrite(deps: WriteDeps, role: "admin" | "editor", input: WriteInput): Promise<{ recorded: true }> {
  assertRoleAllowed(role, input);
  assertSanity(input);
  input = normalizeInput(input);
  input = { ...input, args: sanitizeOptionalText(input.args, ["note", "reason", "address", "accountNumber"]) };
  const s = { db: deps.db, session: deps.session };
  const { entity, action, id, args } = input;
  switch (`${entity}:${action}`) {
    case "loan:create":
      await createLoan(s, args);
      return { recorded: true };
    case "loan_repayment:repay":
      if (!id) throw new Error("A loan id is required");
      await createRepayment(s, id, args);
      return { recorded: true };
    case "expense:create":
      await createExpense(s, args);
      return { recorded: true };
    case "expense:update":
      if (!id) throw new Error("An expense id is required");
      await updateExpense(s, id, args);
      return { recorded: true };
    case "transfer:create":
      await createTransfer(s, args);
      return { recorded: true };
    case "transfer:update":
      if (!id) throw new Error("A transfer id is required");
      await updateTransfer(s, id, args);
      return { recorded: true };
    case "adjustment:create":
      await createAdjustment(s, args);
      return { recorded: true };
    case "adjustment:update":
      if (!id) throw new Error("An adjustment id is required");
      await updateAdjustment(s, id, args);
      return { recorded: true };
    case "member:create":
      await createMember(s, args);
      return { recorded: true };
    case "member:update":
      if (!id) throw new Error("A member id is required");
      await updateMember(s, id, args);
      return { recorded: true };
    case "member:status":
      if (!id) throw new Error("A member id is required");
      await setStatus(s, id, args);
      return { recorded: true };
    case "member:shares":
      if (!id) throw new Error("A member id is required");
      await changeShares(s, id, args);
      return { recorded: true };
    case "bank:create":
      await createBank(s, args);
      return { recorded: true };
    case "bank:update":
      if (!id) throw new Error("A bank account id is required");
      await updateBank(s, id, args);
      return { recorded: true };
    case "contribution:update":
      if (!id) throw new Error("A contribution id is required");
      await updateContribution(s, id, args);
      return { recorded: true };
    default:
      throw new Error(`${entity} ${action} is not a valid write through chat. Valid writes: ${VALID_WRITES}`);
  }
}

const deleteEntities = ["contribution", "loan", "expense", "transfer", "adjustment", "member", "bank"] as const;
export type DeleteEntity = (typeof deleteEntities)[number];

export function deleteInputSchema(role: "admin" | "editor") {
  const entities = deleteEntities.filter((e) => role === "admin" || !ADMIN_ENTITIES.includes(e));
  return z.object({ entity: z.enum(entities), id: z.string().min(1) });
}
export type DeleteInput = { entity: DeleteEntity; id: string };

/** Human identifier for the delete confirm card — name + amount, from DB reads. */
export async function previewDelete(deps: WriteDeps, role: "admin" | "editor", input: DeleteInput): Promise<{ lines: string[] }> {
  assertRoleAllowed(role, { entity: input.entity, action: "create", args: {} });
  const { db } = deps;
  const { entity, id } = input;
  const memberName = async (mid: string) => (await db.member.findUnique({ where: { id: mid } }))?.name ?? mid;
  const bankName = async (bid: string) => (await db.bankAccount.findUnique({ where: { id: bid } }))?.bankName ?? bid;

  switch (entity) {
    case "contribution": {
      const row = await db.contribution.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Contribution not found");
      return { lines: [`Contribution: ${taka(row.amount)} from ${await memberName(row.memberId)} on ${day(row.creditDate)}`] };
    }
    case "loan": {
      const row = await db.loan.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Loan not found");
      return { lines: [`Loan: ${taka(row.amount)} to ${await memberName(row.memberId)} from ${await bankName(row.bankAccountId)} on ${day(row.date)}`, "Its repayments are removed too — balances and outstanding recover."] };
    }
    case "expense": {
      const row = await db.expense.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Expense not found");
      return { lines: [`Expense: ${taka(row.amount)} from ${await bankName(row.bankAccountId)} on ${day(row.date)}`] };
    }
    case "transfer": {
      const row = await db.transfer.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Transfer not found");
      return { lines: [`Transfer: ${taka(row.amount)}, ${await bankName(row.fromAccountId)} → ${await bankName(row.toAccountId)} on ${day(row.date)}`] };
    }
    case "adjustment": {
      const row = await db.adjustment.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Adjustment not found");
      return { lines: [`Adjustment: ${taka(row.amount)} for ${await memberName(row.memberId)} — ${row.reason}`] };
    }
    case "member": {
      const row = await db.member.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Member not found");
      return { lines: [`Member: ${row.name} (${row.mobile})`, "Their records are hidden, not erased — an Admin can purge from the dashboard."] };
    }
    case "bank": {
      const row = await db.bankAccount.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Bank Account not found");
      return { lines: [`Bank Account: ${row.bankName}${row.accountNumber ? ` (${row.accountNumber})` : ""}`, "Only possible while no ledger entries reference it."] };
    }
  }
}

/** Soft-deletes via the same services the dashboard uses (purge is never exposed). */
export async function executeDelete(deps: WriteDeps, role: "admin" | "editor", input: DeleteInput): Promise<{ deleted: true }> {
  assertRoleAllowed(role, { entity: input.entity, action: "create", args: {} });
  const s = { db: deps.db, session: deps.session };
  switch (input.entity) {
    case "contribution":
      await softDeleteContribution(s, input.id);
      return { deleted: true };
    case "loan":
      await softDeleteLoan(s, input.id);
      return { deleted: true };
    case "expense":
      await softDeleteExpense(s, input.id);
      return { deleted: true };
    case "transfer":
      await softDeleteTransfer(s, input.id);
      return { deleted: true };
    case "adjustment":
      await softDeleteAdjustment(s, input.id);
      return { deleted: true };
    case "member":
      await softDeleteMember(s, input.id);
      return { deleted: true };
    case "bank":
      await softDeleteBank(s, input.id);
      return { deleted: true };
  }
}

/** Shared description text so the model knows what its role allows. */
const roleHint = (role: "admin" | "editor") =>
  role === "admin"
    ? "Adjustments and Share changes are included."
    : "Adjustments and Share changes are Admin-only and not available to you.";

export function buildWriteTools(role: "admin" | "editor") {
  const previewWriteTool = toolDefinition({
    name: "preview_write",
    description: `Preview a record change before proposing it (loans, repayments, expenses, transfers, adjustments, members, banks, contribution edits). Resolve ids first with list_members / list_banks. ${roleHint(role)}`,
    inputSchema: writeInputSchema(role),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }).server<AgentContext>(async (input, toolCtx) =>
    previewWrite(asWriteDeps(toolCtx.context), role, input as WriteInput),
  );

  const writeRecordTool = toolDefinition({
    name: "write_record",
    description: `Record a change from preview_write — PAUSES FOR USER APPROVAL; nothing is written until the confirm card is approved. Use identical arguments to the preview. ${roleHint(role)}`,
    inputSchema: writeInputSchema(role),
    outputSchema: z.object({ recorded: z.boolean() }),
    needsApproval: true,
  }).server<AgentContext>(async (input, toolCtx) =>
    executeWrite(asWriteDeps(toolCtx.context), role, input as WriteInput),
  );

  const previewDeleteTool = toolDefinition({
    name: "preview_delete",
    description: "Preview a soft delete before proposing it: shows the record's human identifier (name + amount). Never hard-deletes.",
    inputSchema: deleteInputSchema(role),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }).server<AgentContext>(async (input, toolCtx) =>
    previewDelete(asWriteDeps(toolCtx.context), role, input as DeleteInput),
  );

  const deleteRecordTool = toolDefinition({
    name: "delete_record",
    description: "Soft-delete a record — PAUSES FOR USER APPROVAL showing the record's identifier. Nothing is deleted until approved.",
    inputSchema: deleteInputSchema(role),
    outputSchema: z.object({ deleted: z.boolean() }),
    needsApproval: true,
  }).server<AgentContext>(async (input, toolCtx) =>
    executeDelete(asWriteDeps(toolCtx.context), role, input as DeleteInput),
  );

  return [previewWriteTool, writeRecordTool, previewDeleteTool, deleteRecordTool];
}

/** Adapts a ToolExecutionContext to the WriteDeps shape. */
function asWriteDeps(ctx: AgentContext): WriteDeps {
  return { db: ctx.db, session: ctx.session };
}
