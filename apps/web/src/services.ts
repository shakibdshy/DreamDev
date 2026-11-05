import { createAuth } from "@DreamDev/auth";
import { createPrismaClient } from "@DreamDev/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
