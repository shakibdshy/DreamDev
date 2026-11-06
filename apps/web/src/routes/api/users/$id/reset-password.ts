import { createFileRoute } from "@tanstack/react-router";

import { users } from "@/api/users/http";

export const Route = createFileRoute("/api/users/$id/reset-password")({
  server: {
    handlers: {
      POST: users.postResetPassword,
    },
  },
});
