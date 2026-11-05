import { createFileRoute } from "@tanstack/react-router";

import { banks } from "@/api/banks/http";

export const Route = createFileRoute("/api/banks/")({
  server: {
    handlers: {
      GET: banks.getList,
      POST: banks.postCreate,
    },
  },
});
