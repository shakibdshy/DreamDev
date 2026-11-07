import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

import { getMember, listMembers } from "@/api/members/service";
import { dashboard } from "@/api/dashboard/service";
import { listBanks } from "@/api/banks/service";
import { createContribution, listFeed, memberPosition } from "@/api/transactions/service";

import { previewContributionDef, recordContributionDef } from "./contribution-tools";
import { buildWriteTools, sanitizeOptionalText } from "./write-tools";
import { serviceDeps, type AgentContext } from "./context";

/**
 * The agent's read-only tool set (ticket 3/8). Every tool wraps an existing
 * service function — the same code the dashboard routes call — so role guards
 * and domain invariants apply to the agent exactly as they do to users.
 */

const listMembersTool = toolDefinition({
  name: "list_members",
  description:
    "List fund Members with id, name, mobile, status, shares, Due and Advance. Use it to resolve a Member name (fuzzy search supported) before looking up details.",
  inputSchema: z.object({
    search: z.string().optional().meta({ description: "Fuzzy name or mobile search" }),
    status: z.enum(["active", "inactive", "exited"]).optional(),
  }),
  outputSchema: z.object({
    total: z.number(),
    members: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mobile: z.string(),
        status: z.string(),
        shares: z.number(),
        due: z.number(),
        advance: z.number(),
      }),
    ),
  }),
}).server<AgentContext>(async ({ search, status }, toolCtx) => {
  // The members service has no status filter — single-team scale fits one page,
  // so filter here and report the filtered count.
  const result = await listMembers(serviceDeps(toolCtx.context), { search, page: 1, pageSize: 100 });
  const members = result.data
    .filter((m) => !status || m.status === status)
    .map((m) => ({ id: m.id, name: m.name, mobile: m.mobile, status: m.status, shares: m.shares, due: m.due, advance: m.advance }));
  return { total: members.length, members };
});

const memberPositionTool = toolDefinition({
  name: "member_position",
  description:
    "Get a Member's current position: share quantity, current Share Price, Due (what they owe; negative Due means Advance), and Advance. Requires the Member id.",
  inputSchema: z.object({
    memberId: z.string().meta({ description: "Member id from list_members" }),
  }),
  outputSchema: z.object({
    memberId: z.string(),
    name: z.string(),
    shares: z.number(),
    sharePrice: z.number(),
    due: z.number(),
    advance: z.number(),
  }),
}).server<AgentContext>(async ({ memberId }, toolCtx) => {
  const position = await memberPosition(serviceDeps(toolCtx.context), memberId);
  return {
    memberId: position.memberId,
    name: position.name,
    shares: position.shares,
    sharePrice: position.sharePrice,
    due: position.due,
    advance: position.advance,
  };
});

const memberDetailTool = toolDefinition({
  name: "member_detail",
  description:
    "Full Member profile: contact info, joining date, share history, Due/Advance summary, and this year's month-by-month billing timeline.",
  inputSchema: z.object({
    memberId: z.string().meta({ description: "Member id from list_members" }),
  }),
  outputSchema: z.looseObject({
    member: z.looseObject({ id: z.string(), name: z.string(), status: z.string() }),
    shares: z.array(z.looseObject({ quantity: z.number(), effectiveMonth: z.string() })),
    summary: z.looseObject({ due: z.number(), advance: z.number() }),
  }),
}).server<AgentContext>(async ({ memberId }, toolCtx) => {
  const detail = await getMember(serviceDeps(toolCtx.context), memberId);
  const advanceCoverage = detail.advanceCoverage;
  return {
    member: {
      id: detail.member.id,
      name: detail.member.name,
      mobile: detail.member.mobile,
      joiningDate: detail.member.joiningDate,
      address: detail.member.address,
      notes: detail.member.notes,
      status: detail.member.status,
      exitDate: detail.member.exitDate,
    },
    shares: detail.shares,
    summary: { due: detail.summary.due, advance: detail.summary.advance },
    ...(advanceCoverage
      ? {
          advanceCoverage: {
            months: advanceCoverage.months,
            monthlyBill: advanceCoverage.monthlyBill,
            lastCoveredMonth: advanceCoverage.lastCoveredMonth,
          },
        }
      : {}),
  };
});

const fundOverviewTool = toolDefinition({
  name: "fund_overview",
  description:
    "Dashboard-level fund overview: active member count, total shares, this month's collected vs billed, total outstanding Due, total Advance, loans outstanding, and each bank's current balance.",
  inputSchema: z.object({}),
  outputSchema: z.looseObject({
    activeMembers: z.number(),
    totalDueOutstanding: z.number(),
    totalAdvance: z.number(),
    loansOutstanding: z.number(),
    bankBalances: z.array(z.looseObject({ bankName: z.string(), currentBalance: z.number() })),
  }),
}).server<AgentContext>(async (_input, toolCtx) => {
  const { kpis, topDues, loansPerMember } = await dashboard(serviceDeps(toolCtx.context));
  return {
    activeMembers: kpis.activeMembers,
    totalShares: kpis.totalShares,
    thisMonthCollected: kpis.thisMonthCollected,
    thisMonthBilled: kpis.thisMonthBilled,
    totalDueOutstanding: kpis.totalDueOutstanding,
    totalAdvance: kpis.totalAdvance,
    loansOutstanding: kpis.loansOutstanding,
    bankBalances: kpis.bankBalances.map((b) => ({ bankName: b.bankName, currentBalance: b.currentBalance })),
    topDues: topDues.map((d) => ({ name: d.name, due: d.due })),
    loansPerMember: loansPerMember.map((l) => ({ name: l.name, outstanding: l.outstanding })),
  };
});

const listBanksTool = toolDefinition({
  name: "list_banks",
  description: "List the fund's Bank Accounts with their computed current balance.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total: z.number(),
    banks: z.array(
      z.object({
        id: z.string(),
        bankName: z.string(),
        accountNumber: z.string().nullable(),
        currentBalance: z.number(),
      }),
    ),
  }),
}).server<AgentContext>(async (_input, toolCtx) => {
  const result = await listBanks(serviceDeps(toolCtx.context), {});
  return {
    total: result.meta.total,
    banks: result.data.map((b) => ({
      id: b.id,
      bankName: b.bankName,
      accountNumber: b.accountNumber ?? null,
      currentBalance: b.currentBalance,
    })),
  };
});

const transactionsFeedTool = toolDefinition({
  name: "transactions_feed",
  description:
    "Search the unified Transactions feed (contributions, loans, repayments, expenses, transfers, adjustments) with filters. Newest first by default.",
  inputSchema: z.object({
    type: z.enum(["contribution", "loan", "loan_repayment", "expense", "transfer", "adjustment"]).optional(),
    memberId: z.string().optional(),
    from: z.string().optional().meta({ description: "Date from, YYYY-MM-DD" }),
    to: z.string().optional().meta({ description: "Date to, YYYY-MM-DD" }),
    pageSize: z.number().int().min(1).max(50).optional(),
  }),
  outputSchema: z.object({
    total: z.number(),
    entries: z.array(
      z.object({
        type: z.string(),
        date: z.string(),
        amount: z.number(),
        memberName: z.string().nullable(),
        bankName: z.string().nullable(),
        note: z.string().nullable(),
      }),
    ),
  }),
}).server<AgentContext>(async ({ pageSize, ...query }, toolCtx) => {
  const result = await listFeed(serviceDeps(toolCtx.context), { ...query, page: 1, pageSize: pageSize ?? 20, order: "desc" });
  return {
    total: result.meta.total,
    entries: result.data.map((e) => ({
      type: e.type,
      date: e.date,
      amount: e.amount,
      memberName: e.memberName,
      bankName: e.bankName,
      note: e.note,
    })),
  };
});

/** Assembles the canonical preview for a proposed Contribution (read-only). */
export async function contributionPreview(args: {
  db: AgentContext["db"];
  session: AgentContext["session"];
  memberId: string;
  bankAccountId: string;
  amount: number;
  creditDate: string;
}) {
  const [position, banks] = await Promise.all([
    memberPosition({ db: args.db, session: args.session }, args.memberId),
    listBanks({ db: args.db, session: args.session }, {}),
  ]);
  const bank = banks.data.find((b) => b.id === args.bankAccountId);
  if (!bank) throw new Error("Bank Account not found — call list_banks for valid ids");
  const dueAfter = position.due - args.amount;
  return {
    memberName: position.name,
    bankName: bank.bankName,
    amount: args.amount,
    creditDate: args.creditDate,
    dueBefore: position.due,
    dueAfter,
    advanceAfter: Math.max(0, -dueAfter),
    sharePrice: position.sharePrice,
    shares: position.shares,
  };
}

const previewContributionTool = previewContributionDef.server<AgentContext>(async (args, toolCtx) =>
  contributionPreview({ ...serviceDeps(toolCtx.context), ...args }),
);

const recordContributionTool = recordContributionDef.server<AgentContext>(async (args, toolCtx) => {
  // The executor runs only after the user approves the confirm card. The
  // service re-validates with the same zod schema the dashboard route uses and
  // attributes createdBy from the acting session user.
  const result = await createContribution(serviceDeps(toolCtx.context), sanitizeOptionalText(args, ["note"]));
  const position = await memberPosition(serviceDeps(toolCtx.context), result.memberId);
  return {
    recorded: true,
    contributionId: result.id,
    memberName: position.name,
    amount: result.amount,
    creditDate: result.creditDate.toISOString().slice(0, 10),
  };
});

/** All tools for a role: reads + gated contribution writes + the generic gated surface. */
export function agentTools(role: "admin" | "editor" = "admin") {
  const reads = [listMembersTool, memberPositionTool, memberDetailTool, fundOverviewTool, listBanksTool, transactionsFeedTool];
  return [...reads, previewContributionTool, recordContributionTool, ...buildWriteTools(role)];
}

/** Read-only seam (tests assert no record_ tools exist here). */
export function readTools() {
  return agentTools().filter((tool) => /^list_|_position$|_detail$|fund_overview|_feed$|preview_/.test(tool.name));
}
