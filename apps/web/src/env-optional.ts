import { ENV } from "./env.server";

/**
 * Reads an optional env key, returning undefined both when the key is unset
 * and when varlock's ENV proxy is uninitialized (plain `bun test` never
 * initializes it — the optional feature simply runs in its "not configured"
 * mode there, which is exactly what the tests assert).
 */
export function optionalEnv(key: keyof typeof ENV): string | undefined {
  try {
    return ENV[key];
  } catch {
    return undefined;
  }
}
