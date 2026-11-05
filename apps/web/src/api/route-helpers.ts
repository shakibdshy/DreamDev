import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

import { auth, db } from "@/services";

import { HttpError } from "./http";

export interface ApiContext {
  db: Database;
  session: Session | null;
}

/** Session-resolved context for an API route handler. */
export async function apiContext(request: Request): Promise<ApiContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  return { db, session };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(422, "Invalid JSON body");
  }
}

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}
