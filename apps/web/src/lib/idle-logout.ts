/** Idle-session constants: logout after 15 minutes of inactivity, warning 90s before. */
export const IDLE_LIMIT_MS = 15 * 60_000;
export const IDLE_WARNING_LEAD_MS = 90_000;

/** BroadcastChannel name — activity in any tab resets the timer in all of them. */
export const IDLE_CHANNEL = "dd-idle";

export type IdlePhase = "active" | "warning" | "expired";

/** Pure phase from how long the session has been idle. */
export function idlePhase(idleMs: number): IdlePhase {
  if (idleMs >= IDLE_LIMIT_MS) return "expired";
  if (idleMs >= IDLE_LIMIT_MS - IDLE_WARNING_LEAD_MS) return "warning";
  return "active";
}

/** Whole seconds left before logout (rounded up, clamped at zero; drives the warning text). */
export function secondsLeft(idleMs: number): number {
  return Math.max(0, Math.ceil((IDLE_LIMIT_MS - idleMs) / 1000));
}
