import { createFileRoute } from "@tanstack/react-router";

import { ledger } from "@/api/ledger/http";

export const Route = createFileRoute("/api/expenses/$id/")({
  server: {
    handlers: {
      PATCH: ledger.patchExpense,
      DELETE: ledger.deleteExpense,
    },
  },
});
