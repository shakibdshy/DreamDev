import { createFileRoute } from "@tanstack/react-router";

import { banks } from "@/api/banks/http";

export const Route = createFileRoute("/api/banks/$id/")({
  server: {
    handlers: {
      PATCH: banks.patchUpdate,
      DELETE: banks.deleteBank,
    },
  },
});
