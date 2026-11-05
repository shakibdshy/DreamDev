import { createFileRoute } from "@tanstack/react-router";

import { errorResponse } from "@/api/http";
import { apiContext, ok } from "@/api/route-helpers";
import { deactivateUser } from "@/api/users/service";

export const Route = createFileRoute("/api/users/$id/deactivate")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const ctx = await apiContext(request);
          return ok(await deactivateUser(ctx, params.id));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
