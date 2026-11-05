import { createFileRoute } from "@tanstack/react-router";

import { positions } from "@/api/transactions/http";

export const Route = createFileRoute("/api/members/$id/position")({
  server: {
    handlers: {
      GET: positions.getPosition,
    },
  },
});
