import { createFileRoute } from "@tanstack/react-router";

import { transactions } from "@/api/transactions/http";

export const Route = createFileRoute("/api/contributions/")({
  server: {
    handlers: {
      POST: transactions.postContribution,
    },
  },
});
