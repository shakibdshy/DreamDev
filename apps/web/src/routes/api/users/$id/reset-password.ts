import { createFileRoute } from "@tanstack/react-router";

import { errorResponse } from "@/api/http";
import { apiContext, ok, readJson } from "@/api/route-helpers";
import { resetPassword } from "@/api/users/service";

export const Route = createFileRoute("/api/users/$id/reset-password")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const ctx = await apiContext(request);
          return ok(await resetPassword(ctx, params.id, await readJson(request)));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
