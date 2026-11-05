import type { Database } from "@DreamDev/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
};

/** Roles per the spec: Admin manages everything, Editor manages fund data only. */
export type UserRole = "admin" | "editor";

export function createAuth(env: AuthConfig, database: Database) {
  return betterAuth({
    database: prismaAdapter(database, {
      provider: "postgresql",
    }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [tanstackStartCookies()],
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "editor", input: false },
        status: { type: "string", defaultValue: "active", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            // The first ever User becomes Admin; everyone after starts as Editor.
            const userCount = await database.user.count();
            return { data: { ...user, role: userCount === 0 ? "admin" : "editor" } };
          },
        },
      },
      session: {
        create: {
          async before(session) {
            // Deactivated Users cannot open sessions — blocks sign-in and refresh alike.
            const user = await database.user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            return user?.status === "active" ? { data: session } : false;
          },
        },
      },
    },
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
