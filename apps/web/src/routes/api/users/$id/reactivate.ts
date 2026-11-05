import { createFileRoute } from "@tanstack/react-router";

import { errorResponse } from "@/api/http";
import { apiContext, ok } from "@/api/route-helpers";
import { reactivateUser } from "@/api/users/service";

export const Route = createFileRoute("/api/users/$id/reactivate")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const ctx = await apiContext(request);
          return ok(await reactivateUser(ctx, params.id));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
