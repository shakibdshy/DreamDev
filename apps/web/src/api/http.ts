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

const originOf = (value: string): string | null => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

/**
 * The origin clients see: forwarded proxy headers win over the internal request URL.
 * Deployment assumption: the front proxy overwrites `x-forwarded-host`/`-proto`
 * on every request so a client cannot choose the value the Origin is compared to.
 * Defaulting to https when the proxy omits `-proto` keeps TLS-terminating
 * proxies working.
 */
const publicOriginOf = (request: Request): string | null => {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (host) {
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    return originOf(`${protocol}://${host}`);
  }
  return originOf(request.url);
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
    // Compare complete origins (scheme + host), not hostnames: an HTTP Origin
    // must not pass for an HTTPS app just because the host matches.
    const publicOrigin = publicOriginOf(request);
    // Fail closed: if we cannot establish a public origin, an untrusted Origin
    // cannot be accepted just because the comparison was skipped.
    if (!publicOrigin || originOf(origin) !== publicOrigin) {
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
