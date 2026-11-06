import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

/**
 * Runtime context handed to every agent tool through chat({ context }) —
 * it never reaches the model. Tools call the same services the HTTP routes
 * call, so validation, role guards, and domain invariants all apply.
 */
export interface AgentContext {
  db: Database;
  session: Session;
  /** Where the conversation runs — audit rows record it. */
  channel: "web" | "telegram";
}

/** Service-shaped deps — the {db, session} pair every service function takes. */
export function serviceDeps(ctx: AgentContext) {
  return { db: ctx.db, session: ctx.session };
}
