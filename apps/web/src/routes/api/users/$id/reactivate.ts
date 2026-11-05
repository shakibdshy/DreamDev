import { createFileRoute } from "@tanstack/react-router";

import { users } from "@/api/users/http";

export const Route = createFileRoute("/api/users/$id/reactivate")({
  server: {
    handlers: {
      POST: users.postReactivate,
    },
  },
});
