import { createFileRoute } from "@tanstack/react-router";

import { users } from "@/api/users/http";

export const Route = createFileRoute("/api/users/$id/")({
  server: {
    handlers: {
      PATCH: users.patchUpdate,
    },
  },
});
