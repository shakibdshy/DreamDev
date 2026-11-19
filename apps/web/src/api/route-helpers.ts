import type { Session } from "@DreamDev/auth";
import type { Database } from "@DreamDev/db";

import { assertSameOrigin, errorResponse } from "./http";

export interface ApiContext {
  db: Database;
  session: Session | null;
}

/** Resolves the request context (db + session) for an API handler. */
export type ApiResolver = (request: Request) => Promise<ApiContext>;

/** Production resolver: the app's singletons. Lazily imported so tests can bind their own. */
export const appContext: ApiResolver = async (request) => {
  const { auth, db } = await import("@/services");
  const session = await auth.api.getSession({ headers: request.headers });
  return { db, session };
};

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Reads a JSON body; invalid JSON parses as null so zod reports a 422. */
export async function readBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

/** Wraps a service call with session resolution and error mapping — the whole route body. */
export function withApi(
  handler: (ctx: ApiContext, request: Request, params: Record<string, string>) => Promise<unknown>,
  resolve: ApiResolver,
) {
  return async ({ request, params }: { request: Request; params?: Record<string, string> }) => {
    try {
      assertSameOrigin(request); // CSRF: foreign-origin unsafe methods never reach the DB
      const result = await handler(await resolve(request), request, params ?? {});
      return result instanceof Response ? result : ok(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
