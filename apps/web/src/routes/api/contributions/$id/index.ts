import { createFileRoute } from "@tanstack/react-router";

import { transactions } from "@/api/transactions/http";

export const Route = createFileRoute("/api/contributions/$id/")({
  server: {
    handlers: {
      PATCH: transactions.patchContribution,
      DELETE: transactions.deleteContribution,
    },
  },
});
