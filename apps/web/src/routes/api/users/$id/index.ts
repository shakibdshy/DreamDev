import { createFileRoute } from "@tanstack/react-router";

import { errorResponse } from "@/api/http";
import { apiContext, ok, readJson } from "@/api/route-helpers";
import { updateUser } from "@/api/users/service";

export const Route = createFileRoute("/api/users/$id/")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const ctx = await apiContext(request);
          return ok(await updateUser(ctx, params.id, await readJson(request)));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
