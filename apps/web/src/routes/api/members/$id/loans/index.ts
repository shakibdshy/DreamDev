import { createFileRoute } from "@tanstack/react-router";

import { loans } from "@/api/loans/http";

export const Route = createFileRoute("/api/members/$id/loans/")({
  server: {
    handlers: {
      GET: loans.getList,
      POST: loans.postCreate,
    },
  },
});
