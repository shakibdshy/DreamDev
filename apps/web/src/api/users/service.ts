import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";
import { hashPassword } from "better-auth/crypto";

import { HttpError, parseOr422, requireUser } from "../http";
import {
  createUserBodySchema,
  listUsersQuerySchema,
  resetPasswordBodySchema,
  updateUserBodySchema,
} from "./schema";

export interface UsersDeps {
  db: Database;
  session: Session | null;
}

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

function requireAdmin(session: Session | null) {
  const user = requireUser(session);
  if (user.role !== "admin") throw new HttpError(403, "Admin role required");
  return user;
}

/**
 * Guards operations that strip the last line of Admin access: never yourself,
 * never the last active Admin (also holds defensively for deactivation — the
 * actor is always another active Admin there, but role changes reach it).
 */
async function assertTargetMutable(
  db: Database,
  target: { id: string; role: string; status: string },
  actorId: string,
  action: string,
) {
  if (target.id === actorId) throw new HttpError(409, `You cannot ${action} your own account`);
  if (target.role === "admin" && target.status === "active") {
    const activeAdmins = await db.user.count({ where: { role: "admin", status: "active" } });
    if (activeAdmins <= 1) throw new HttpError(409, `Cannot ${action} the last active Admin`);
  }
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  lastSignInAt: Date | null;
}

/** Paginated user list (server-side, single query per page — no N+1). */
export async function listUsers(deps: UsersDeps, query: unknown) {
  requireAdmin(deps.session);
  const { page, pageSize, sort, order } = parseOr422(listUsersQuerySchema, query);

  const orderBy = { [sort]: order };

  const [users, total] = await Promise.all([
    deps.db.user.findMany({
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { ...publicUser, sessions: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    deps.db.user.count(),
  ]);

  const data: UserListItem[] = users.map(({ sessions, ...user }) => ({
    ...user,
    lastSignInAt: sessions[0]?.createdAt ?? null,
  }));

  return { data, meta: { page, pageSize, total } };
}

/** Creates a User with a credential account (Admin only). */
export async function createUser(deps: UsersDeps, body: unknown) {
  requireAdmin(deps.session);
  const input = parseOr422(createUserBodySchema, body);

  const existing = await deps.db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new HttpError(409, "A user with this email already exists");

  const user = await deps.db.user.create({
    data: { id: crypto.randomUUID(), name: input.name, email: input.email, role: input.role, status: "active" },
  });
  await deps.db.account.create({
    data: {
      id: crypto.randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(input.password),
    },
  });

  return user;
}

/** Updates name and/or role (Admin only). Role takes effect on the next request. */
export async function updateUser(deps: UsersDeps, id: string, body: unknown) {
  const actor = requireAdmin(deps.session);
  const input = parseOr422(updateUserBodySchema, body);

  const target = await deps.db.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, "User not found");

  // Demoting an active Admin can strand the fund without any Admin
  if (input.role === "editor" && target.role === "admin" && target.status === "active") {
    await assertTargetMutable(deps.db, target, actor.id, "demote");
  }

  return deps.db.user.update({
    where: { id },
    data: { name: input.name, role: input.role },
    select: publicUser,
  });
}

/** Deactivates a User and revokes every session (Admin only). */
export async function deactivateUser(deps: UsersDeps, id: string) {
  const actor = requireAdmin(deps.session);

  const target = await deps.db.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, "User not found");
  await assertTargetMutable(deps.db, target, actor.id, "deactivate");

  const [deactivated] = await deps.db.$transaction([
    deps.db.user.update({ where: { id }, data: { status: "deactivated" }, select: publicUser }),
    deps.db.session.deleteMany({ where: { userId: id } }),
  ]);
  return deactivated;
}

/** Restores a deactivated User (Admin only). */
export async function reactivateUser(deps: UsersDeps, id: string) {
  requireAdmin(deps.session);
  const target = await deps.db.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, "User not found");
  return deps.db.user.update({ where: { id }, data: { status: "active" }, select: publicUser });
}

/** Sets a new password for a User (Admin only) and revokes their sessions — the old password stops working everywhere. */
export async function resetPassword(deps: UsersDeps, id: string, body: unknown) {
  requireAdmin(deps.session);
  const { newPassword } = parseOr422(resetPasswordBodySchema, body);

  const account = await deps.db.account.findFirst({ where: { userId: id, providerId: "credential" } });
  if (!account) throw new HttpError(404, "User has no password account");

  await deps.db.$transaction([
    deps.db.account.update({
      where: { id: account.id },
      data: { password: await hashPassword(newPassword) },
    }),
    deps.db.session.deleteMany({ where: { userId: id } }),
  ]);
  return { ok: true };
}
