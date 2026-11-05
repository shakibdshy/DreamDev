import { $ } from "bun";
import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import type { DatabaseConfig } from "../config";
import { createPrismaClient, type Database } from "../index";

/**
 * Per-run test PostgreSQL (ticket #2): derives a `<name>_test` database from
 * the workspace DATABASE_URL, creates it if missing, pushes the Prisma schema,
 * and truncates every public table between tests. Later tickets' API tests reuse this.
 */
const WEB_ENV = path.resolve(import.meta.dir, "../../../../apps/web/.env");

async function databaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const raw = await readFile(WEB_ENV, "utf8");
  const line = raw.split("\n").find((l) => l.trimStart().startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL is not set and was not found in apps/web/.env");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

function databaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name) throw new Error(`No database name in ${url} — cannot derive a test database`);
  return name;
}

function testUrlFor(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName(url)}_test`;
  return parsed.toString();
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

let setup: Promise<{ db: Database; admin: ReturnType<typeof postgres> }> | undefined;

/** Boots the test database once per run and returns a connected Prisma client. */
export function setupTestDb(): Promise<Database> {
  return boot().then(({ db }) => db);
}

function boot() {
  setup ??= (async () => {
    const baseUrl = await databaseUrl();
    const testUrl = testUrlFor(baseUrl);
    await ensureDatabaseExists(baseUrl, testUrl);
    await pushSchema(testUrl);
    const db = createPrismaClient({ DATABASE_URL: testUrl } satisfies DatabaseConfig);
    const admin = postgres(testUrl, {
      ssl: isLocal(testUrl) ? false : { rejectUnauthorized: false },
      max: 1,
      idle_timeout: 5,
    });
    return { db, admin };
  })();
  return setup;
}

async function ensureDatabaseExists(baseUrl: string, testUrl: string): Promise<void> {
  const admin = postgres(baseUrl, {
    ssl: isLocal(baseUrl) ? false : { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 5,
  });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName(testUrl)}"`);
  } catch (error) {
    // 42P04 duplicate_database — already created by a previous run
    if (!String(error).includes("already exists")) throw error;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function pushSchema(testUrl: string): Promise<void> {
  await $`DATABASE_URL=${testUrl} bun run db:push -- --accept-data-loss`.quiet();
}

/** Truncates every table in the public schema — run between tests for isolation. */
export async function resetDb(): Promise<void> {
  const { admin } = await boot();
  const tables = await admin<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await admin.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
