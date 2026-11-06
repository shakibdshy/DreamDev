export function firstError(errors: unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === "string" && error) return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = String((error as { message: unknown }).message ?? "");
      if (message) return message;
    }
  }
  return undefined;
}
