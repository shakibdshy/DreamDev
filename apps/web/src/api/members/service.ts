import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { monthOfDate } from "@DreamDev/db/domain/month";
import { projectMonths, type MonthCell } from "@DreamDev/db/domain/projection";
import { dueSummary, type DueSummary } from "@DreamDev/db/domain/due";

import { HttpError, parseOr422, requireUser } from "../http";
import { getPriceEntries, memberFacts } from "./billing-facts";
import {
  changeSharesBodySchema,
  createMemberBodySchema,
  listMembersQuerySchema,
  setStatusBodySchema,
  updateMemberBodySchema,
} from "./schema";

export interface MembersDeps {
  db: Database;
  session: Session | null;
}

function requireAdmin(session: Session | null) {
  const user = requireUser(session);
  if (user.role !== "admin") throw new HttpError(403, "Admin role required");
  return user;
}

export interface MemberListItem {
  id: string;
  name: string;
  mobile: string;
  joiningDate: Date;
  address: string | null;
  photo: string | null;
  status: string;
  shares: number;
  due: number;
  advance: number;
}

const publicMember = {
  id: true,
  name: true,
  mobile: true,
  joiningDate: true,
  address: true,
  photo: true,
  notes: true,
  status: true,
  exitDate: true,
  createdAt: true,
} as const;

/** Paginated member list with live Due/Advance — batched queries, no N+1. */
export async function listMembers(deps: MembersDeps, query: unknown) {
  requireUser(deps.session);
  const { page, pageSize, sort, order, search } = parseOr422(listMembersQuerySchema, query);
  const through = monthOfDate(new Date());

  const where = {
    deletedAt: null,
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { mobile: { contains: search } }] } : {}),
  };

  const [members, total, prices] = await Promise.all([
    deps.db.member.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * pageSize, take: pageSize }),
    deps.db.member.count({ where }),
    getPriceEntries(deps.db),
  ]);

  const ids = members.map((m) => m.id);
  const [allotments, statusChanges, contributionSums, adjustmentSums] = await Promise.all([
    ids.length ? deps.db.shareAllotment.findMany({ where: { memberId: { in: ids } } }) : [],
    ids.length ? deps.db.memberStatusChange.findMany({ where: { memberId: { in: ids } } }) : [],
    ids.length
      ? deps.db.contribution.groupBy({ by: ["memberId"], _sum: { amount: true }, where: { deletedAt: null, memberId: { in: ids } } })
      : [],
    ids.length
      ? deps.db.adjustment.groupBy({ by: ["memberId"], _sum: { amount: true }, where: { deletedAt: null, memberId: { in: ids } } })
      : [],
  ]);
  const contributedByMember = new Map(contributionSums.map((r) => [r.memberId, r._sum.amount ?? 0]));
  const adjustedByMember = new Map(adjustmentSums.map((r) => [r.memberId, r._sum.amount ?? 0]));

  const data: MemberListItem[] = members.map((member) => {
    const facts = memberFacts(
      member,
      allotments.filter((a) => a.memberId === member.id),
      prices,
      statusChanges.filter((c) => c.memberId === member.id),
    );
    const entries = [
      ...(contributedByMember.get(member.id) ?? 0)
        ? [{ date: "1970-01-01", amount: contributedByMember.get(member.id)!, kind: "contribution" as const }]
        : [],
      ...(adjustedByMember.get(member.id) ?? 0)
        ? [{ date: "1970-01-01", amount: adjustedByMember.get(member.id)!, kind: "adjustment" as const }]
        : [],
    ];
    const summary = dueSummary(facts, entries, through);
    return {
      id: member.id,
      name: member.name,
      mobile: member.mobile,
      joiningDate: member.joiningDate,
      address: member.address,
      photo: member.photo,
      status: member.status,
      shares: facts.allotments[facts.allotments.length - 1]?.quantity ?? 0,
      due: summary.due,
      advance: summary.advance,
    };
  });

  return { data, meta: { page, pageSize, total } };
}

/** Creates a Member plus their first Share Allotment, fixed at joining (spec). */
export async function createMember(deps: MembersDeps, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(createMemberBodySchema, body);

  const existing = await deps.db.member.findUnique({ where: { mobile: input.mobile } });
  if (existing) throw new HttpError(409, "A member with this mobile number already exists");

  const joiningDate = new Date(`${input.joiningDate}T00:00:00Z`);
  return deps.db.$transaction(async (tx) => {
    const member = await tx.member.create({
      data: {
        name: input.name,
        mobile: input.mobile,
        joiningDate,
        address: input.address,
        notes: input.notes,
        createdBy: user.id,
      },
      select: publicMember,
    });
    await tx.shareAllotment.create({
      data: {
        memberId: member.id,
        quantity: input.shareQuantity,
        effectiveMonth: monthOfDate(joiningDate),
        createdBy: user.id,
      },
    });
    return member;
  });
}

export async function getMember(deps: MembersDeps, id: string, year?: number) {
  requireUser(deps.session);
  const member = await deps.db.member.findUnique({ where: { id } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");

  const [allotmentsRaw, statusChanges, prices, contributions, adjustments] = await Promise.all([
    deps.db.shareAllotment.findMany({ where: { memberId: id }, orderBy: { effectiveMonth: "asc" } }),
    deps.db.memberStatusChange.findMany({ where: { memberId: id }, orderBy: { date: "asc" } }),
    getPriceEntries(deps.db),
    deps.db.contribution.findMany({ where: { memberId: id, deletedAt: null }, orderBy: { creditDate: "asc" } }),
    deps.db.adjustment.findMany({ where: { memberId: id, deletedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);

  const facts = memberFacts(member, allotmentsRaw, prices, statusChanges);
  const entries = [
    ...contributions.map((c) => ({ date: c.creditDate.toISOString().slice(0, 10), amount: c.amount, kind: "contribution" as const })),
    ...adjustments.map((a) => ({
      date: (a.month ? `${a.month}-15` : a.createdAt.toISOString().slice(0, 10)),
      amount: a.amount,
      kind: "adjustment" as const,
    })),
  ];

  const through = monthOfDate(new Date());
  const summary: DueSummary = dueSummary(facts, entries, through);

  const timelineYear = year ?? new Date().getFullYear();
  // Never show future months as due — cap at the current month
  const timelineThrough = timelineYear < Number(through.slice(0, 4)) ? `${timelineYear}-12` : through;
  const timeline: MonthCell[] = projectMonths(facts, entries, `${timelineYear}-01`, timelineThrough);

  return {
    member: {
      id: member.id,
      name: member.name,
      mobile: member.mobile,
      joiningDate: member.joiningDate,
      address: member.address,
      photo: member.photo,
      notes: member.notes,
      status: member.status,
      exitDate: member.exitDate,
      createdAt: member.createdAt,
    },
    shares: allotmentsRaw.map((a) => ({ quantity: a.quantity, effectiveMonth: a.effectiveMonth })),
    summary,
    timelineYear,
    timeline,
  };
}

/** Editor-editable fields only — Share quantity changes go through changeShares (Admin). */
export async function updateMember(deps: MembersDeps, id: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(updateMemberBodySchema, body);

  const member = await deps.db.member.findUnique({ where: { id } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");

  if (input.mobile && input.mobile !== member.mobile) {
    const existing = await deps.db.member.findUnique({ where: { mobile: input.mobile } });
    if (existing) throw new HttpError(409, "A member with this mobile number already exists");
  }

  return deps.db.member.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
      ...(input.joiningDate !== undefined ? { joiningDate: new Date(`${input.joiningDate}T00:00:00Z`) } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedBy: user.id,
    },
    select: publicMember,
  });
}

/** Admin-only, forward-effective Share quantity change (spec: permission-gated). */
export async function changeShares(deps: MembersDeps, id: string, body: unknown) {
  const user = requireAdmin(deps.session);
  const input = parseOr422(changeSharesBodySchema, body);

  const member = await deps.db.member.findUnique({ where: { id } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");

  const effectiveMonth = input.effectiveMonth ?? monthOfDate(new Date());
  await deps.db.shareAllotment.create({
    data: { memberId: id, quantity: input.quantity, effectiveMonth, createdBy: user.id },
  });

  return { id, quantity: input.quantity, effectiveMonth };
}

/** Status lifecycle: active ⇄ inactive, exit (stops Billing at exit month), audit-trailed. */
export async function setStatus(deps: MembersDeps, id: string, body: unknown) {
  const user = requireUser(deps.session);
  const input = parseOr422(setStatusBodySchema, body);
  const date = new Date(`${input.date}T00:00:00Z`);

  const member = await deps.db.member.findUnique({ where: { id } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");
  if (member.status === input.status) throw new HttpError(409, `Member is already ${input.status}`);

  return deps.db.$transaction(async (tx) => {
    await tx.memberStatusChange.create({ data: { memberId: id, status: input.status, date, note: input.note, createdBy: user.id } });
    return tx.member.update({
      where: { id },
      data: { status: input.status, ...(input.status === "exited" ? { exitDate: date } : { exitDate: null }) },
      select: publicMember,
    });
  });
}

export async function softDeleteMember(deps: MembersDeps, id: string) {
  requireUser(deps.session);
  const member = await deps.db.member.findUnique({ where: { id } });
  if (!member || member.deletedAt) throw new HttpError(404, "Member not found");
  await deps.db.member.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

/** Admin-only purge — refused while any ledger entry or allotment references the Member. */
export async function purgeMember(deps: MembersDeps, id: string) {
  requireAdmin(deps.session);
  const member = await deps.db.member.findUnique({ where: { id } });
  if (!member) throw new HttpError(404, "Member not found");

  const [contributions, loans, repayments, adjustments] = await Promise.all([
    deps.db.contribution.count({ where: { memberId: id } }),
    deps.db.loan.count({ where: { memberId: id } }),
    deps.db.loanRepayment.count({ where: { memberId: id } }),
    deps.db.adjustment.count({ where: { memberId: id } }),
  ]);
  const references = contributions + loans + repayments + adjustments;
  if (references > 0) {
    throw new HttpError(409, `Cannot delete: ${references} ledger entr${references === 1 ? "y" : "ies"} reference this member`);
  }

  await deps.db.$transaction([
    deps.db.shareAllotment.deleteMany({ where: { memberId: id } }),
    deps.db.memberStatusChange.deleteMany({ where: { memberId: id } }),
    deps.db.member.delete({ where: { id } }),
  ]);
  return { ok: true };
}
