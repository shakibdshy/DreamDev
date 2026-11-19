import type { Session } from "@DreamDev/auth";

/** Application HTTP error — carries the status the route layer must respond with. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Any active, authenticated User (Admin or Editor) may proceed. */
export function requireUser(session: Session | null) {
  if (!session?.user) throw new HttpError(401, "Authentication required");
  if (session.user.status !== "active") throw new HttpError(401, "Session no longer valid");
  return session.user;
}

/** Parses with a zod schema, throwing a 422 HttpError on invalid input. */
export function parseOr422<T>(
  schema: {
    safeParse: (input: unknown) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    throw new HttpError(422, first ? `${path ? `${path}: ` : ""}${first.message}` : "Invalid input");
  }
  return result.data;
}

const UNSAFE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const hostOf = (value: string): string | null => {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

/**
 * CSRF guard for the cookie-session API: on an unsafe method, a foreign Origin
 * or a cross-site Sec-Fetch-Site is refused (403). SameSite=Lax session
 * cookies are the first layer; this is the explicit one. Absent headers (curl,
 * server-to-server webhooks, tests) pass — authentication still gates those.
 */
export function assertSameOrigin(request: Request): void {
  if (!UNSAFE_METHODS.has(request.method)) return;

  const origin = request.headers.get("origin");
  if (origin) {
    // Behind proxies the request URL host differs from the public one — trust
    // the forwarded host (first hop) as the public identity.
    const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const publicHost = forwarded ? hostOf(`https://${forwarded}`) : hostOf(request.url);
    if (publicHost && hostOf(origin) !== publicHost) {
      throw new HttpError(403, "Cross-site request refused");
    }
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "Cross-site request refused");
  }
}

/** Maps any thrown value to a JSON-able error response. */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return Response.json({ error: "Invalid input", issues: JSON.parse(error.message) }, { status: 422 });
  }
  console.error("Unhandled API error", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
