import { createFileRoute } from "@tanstack/react-router";

import { ledger } from "@/api/ledger/http";

export const Route = createFileRoute("/api/expenses/")({
  server: {
    handlers: {
      POST: ledger.postExpense,
    },
  },
});
