import type { Session } from "@DreamDev/auth";

/** A minimal session-shaped object — services only read id/role/status. */
export function sessionFor(user: { id: string; role: string; status?: string }): Session {
  return {
    user: { id: user.id, role: user.role, status: user.status ?? "active" },
    session: { id: `sess-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  } as unknown as Session;
}
