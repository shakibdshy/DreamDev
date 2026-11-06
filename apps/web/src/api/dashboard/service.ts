import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { addMonths, monthOfDate } from "@DreamDev/db/domain/month";
import { billForMonth } from "@DreamDev/db/domain/billing";
import { dueSummary } from "@DreamDev/db/domain/due";
import { projectMonths } from "@DreamDev/db/domain/projection";

import { requireUser } from "../http";
import { getPriceEntries, memberFacts, toMemberEntries } from "../members/billing-facts";
import { listBanks } from "../banks/service";
import { listFeed, type FeedEntry } from "../transactions/service";

export interface DashboardDeps {
  db: Database;
  session: Session | null;
}

export interface DashboardData {
  kpis: {
    activeMembers: number;
    totalShares: number;
    thisMonthCollected: number;
    thisMonthBilled: number;
    totalDueOutstanding: number;
    totalAdvance: number;
    loansOutstanding: number;
    bankBalances: { id: string; bankName: string; currentBalance: number }[];
  };
  monthlySeries: { month: string; collected: number }[];
  gridYear: number;
  grid: { memberId: string; name: string; cells: { month: string; status: string; bill: number; applied: number }[] }[];
  topDues: { memberId: string; name: string; due: number }[];
  recent: FeedEntry[];
  loansPerMember: { memberId: string; name: string; outstanding: number }[];
}

/** The month's own bill plus its Adjustments — no rolled-in debt from earlier months. */
function effectiveBillFor(facts: ReturnType<typeof memberFacts>, memberAdjustments: { month: string | null; createdAt: Date; amount: number }[], month: string): number {
  const adjustmentTotal = memberAdjustments
    .filter((a) => (a.month ?? monthOfDate(a.createdAt)) === month)
    .reduce((sum, a) => sum + a.amount, 0);
  return Math.max(0, billForMonth(facts, month) + adjustmentTotal);
}

/** One round-trip dashboard: every KPI, the 12-month series, the member×month grid, top dues, recents, loans. */
export async function dashboard(deps: DashboardDeps, year?: number): Promise<DashboardData> {
  requireUser(deps.session);

  const through = monthOfDate(new Date());
  const gridYear = year ?? Number(through.slice(0, 4));
  const seriesStart = addMonths(through, -11);

  const [members, prices, banks, contributions, adjustments, loansRaw, repaymentsRaw, contributions12m, recentFeed] = await Promise.all([
    deps.db.member.findMany({ where: { deletedAt: null } }),
    getPriceEntries(deps.db),
    listBanks(deps, {}),
    deps.db.contribution.findMany({ where: { deletedAt: null } }),
    deps.db.adjustment.findMany({ where: { deletedAt: null } }),
    deps.db.loan.findMany({ where: { deletedAt: null } }),
    deps.db.loanRepayment.findMany({ where: { deletedAt: null } }),
    deps.db.contribution.findMany({
      where: { deletedAt: null, creditDate: { gte: new Date(`${seriesStart}-01T00:00:00Z`) } },
    }),
    listFeed(deps, { page: 1, pageSize: 5, order: "desc" }),
  ]);

  const [allotments, statusChanges] = await Promise.all([
    deps.db.shareAllotment.findMany({ orderBy: { effectiveMonth: "asc" } }),
    deps.db.memberStatusChange.findMany({}),
  ]);

  const adjustmentsOf = (memberId: string) => adjustments.filter((a) => a.memberId === memberId);

  // Per-member positions
  const dues: { memberId: string; name: string; due: number; advance: number; shares: number; billedThisMonth: number }[] = members.map(
    (member) => {
      const facts = memberFacts(
        member,
        allotments.filter((a) => a.memberId === member.id),
        prices,
        statusChanges.filter((c) => c.memberId === member.id),
      );
      const entries = toMemberEntries(
        contributions.filter((c) => c.memberId === member.id),
        adjustments.filter((a) => a.memberId === member.id),
      );
      const summary = dueSummary(facts, entries, through);
      const shares = facts.allotments[facts.allotments.length - 1]?.quantity ?? 0;
      return {
        memberId: member.id,
        name: member.name,
        due: summary.due,
        advance: summary.advance,
        shares,
        billedThisMonth: effectiveBillFor(facts, adjustmentsOf(member.id), through),
      };
    },
  );

  // Loans outstanding per member
  const loanTotals = new Map<string, number>();
  for (const loan of loansRaw) loanTotals.set(loan.memberId, (loanTotals.get(loan.memberId) ?? 0) + loan.amount);
  for (const repayment of repaymentsRaw)
    loanTotals.set(repayment.memberId, (loanTotals.get(repayment.memberId) ?? 0) - repayment.amount);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const loansPerMember = [...loanTotals.entries()]
    .filter(([, outstanding]) => outstanding > 0)
    .map(([memberId, outstanding]) => ({ memberId, name: memberName.get(memberId) ?? "—", outstanding }))
    .sort((a, b) => b.outstanding - a.outstanding);

  // 12-month collection series
  const seriesMap = new Map<string, number>();
  for (let i = 0; i < 12; i++) seriesMap.set(addMonths(seriesStart, i), 0);
  for (const contribution of contributions12m) {
    const month = monthOfDate(contribution.creditDate);
    if (seriesMap.has(month)) seriesMap.set(month, (seriesMap.get(month) ?? 0) + contribution.amount);
  }

  // Member × month grid for the chosen year, including upcoming months so an
  // Advance shows as covering them (projected at today's shares and price)
  const gridThrough = `${gridYear}-12`;
  const grid = dues.map(({ memberId, name }) => {
    const member = members.find((m) => m.id === memberId)!;
    const facts = memberFacts(
      member,
      allotments.filter((a) => a.memberId === memberId),
      prices,
      statusChanges.filter((c) => c.memberId === memberId),
    );
    const entries = toMemberEntries(
      contributions.filter((c) => c.memberId === memberId),
      adjustments.filter((a) => a.memberId === memberId),
    );
    const cells = projectMonths(facts, entries, `${gridYear}-01`, gridThrough).map((cell) => ({
      month: cell.month,
      status: cell.status,
      bill: cell.bill,
      applied: cell.applied,
    }));
    // Only show months from the joining month onward
    const startIdx = cells.findIndex((cell) => cell.month >= facts.joiningMonth);
    return { memberId, name, cells: startIdx === -1 ? cells : cells.slice(startIdx) };
  });

  const thisMonthCollected = seriesMap.get(through) ?? 0;

  return {
    kpis: {
      activeMembers: members.filter((m) => m.status === "active").length,
      totalShares: dues.filter((d) => members.find((m) => m.id === d.memberId)?.status !== "exited").reduce((sum, d) => sum + d.shares, 0),
      thisMonthCollected,
      thisMonthBilled: dues.reduce((sum, d) => sum + d.billedThisMonth, 0),
      totalDueOutstanding: dues.reduce((sum, d) => sum + Math.max(0, d.due), 0),
      totalAdvance: dues.reduce((sum, d) => sum + d.advance, 0),
      loansOutstanding: loansPerMember.reduce((sum, l) => sum + l.outstanding, 0),
      bankBalances: banks.data.map((b) => ({ id: b.id, bankName: b.bankName, currentBalance: b.currentBalance })),
    },
    monthlySeries: [...seriesMap.entries()].map(([month, collected]) => ({ month, collected })),
    gridYear,
    grid,
    topDues: dues
      .filter((d) => d.due > 0)
      .sort((a, b) => b.due - a.due)
      .slice(0, 5)
      .map(({ memberId, name, due }) => ({ memberId, name, due })),
    recent: recentFeed.data,
    loansPerMember,
  };
}
