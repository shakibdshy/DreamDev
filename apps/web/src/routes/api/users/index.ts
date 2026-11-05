import { createFileRoute } from "@tanstack/react-router";

import { users } from "@/api/users/http";

export const Route = createFileRoute("/api/users/")({
  server: {
    handlers: {
      GET: users.getList,
      POST: users.postCreate,
    },
  },
});
