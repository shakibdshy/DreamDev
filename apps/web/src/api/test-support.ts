import type { Session } from "@DreamDev/auth";
import { addMonths, monthOfDate, todayInDhaka } from "@DreamDev/db/domain/month";

/** A minimal session-shaped object — services only read id/role/status. */
export function sessionFor(user: { id: string; role: string; status?: string }): Session {
  return {
    user: { id: user.id, role: user.role, status: user.status ?? "active" },
    session: { id: `sess-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  } as unknown as Session;
}

/** A `YYYY-MM` that is always in the past — record dates can never be future. */
export function pastMonth(): string {
  return addMonths(monthOfDate(new Date()), -1);
}

/** Day `n` of `month`, clamped to today's Dhaka day for current-month tests. */
export function thisDay(month: string, n: number): string {
  const day = Math.max(1, Math.min(n, Number(todayInDhaka().slice(8, 10))));
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Tomorrow (YYYY-MM-DD, Dhaka clock) — the canonical rejected date in tests. */
export function futureDay(): string {
  const day = new Date(`${todayInDhaka()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
