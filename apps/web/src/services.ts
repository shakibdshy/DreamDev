import { createAuth } from "@DreamDev/auth";
import { createPrismaClient } from "@DreamDev/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
// Pass only the declared env keys — varlock's ENV proxy throws on unknown keys
// (disableRateLimit is a test-only AuthConfig field, never an env var).
export const auth = createAuth(
  { BETTER_AUTH_URL: ENV.BETTER_AUTH_URL, BETTER_AUTH_SECRET: ENV.BETTER_AUTH_SECRET },
  db,
);
