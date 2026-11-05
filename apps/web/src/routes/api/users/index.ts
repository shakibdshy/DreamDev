import { createFileRoute } from "@tanstack/react-router";

import { errorResponse } from "@/api/http";
import { apiContext, ok, readJson } from "@/api/route-helpers";
import { createUser, listUsers } from "@/api/users/service";

export const Route = createFileRoute("/api/users/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await apiContext(request);
          const query = Object.fromEntries(new URL(request.url).searchParams);
          return ok(await listUsers(ctx, query));
        } catch (error) {
          return errorResponse(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const ctx = await apiContext(request);
          return ok(await createUser(ctx, await readJson(request)), 201);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
