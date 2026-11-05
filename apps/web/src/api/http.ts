/** Application HTTP error — carries the status the route layer must respond with. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
