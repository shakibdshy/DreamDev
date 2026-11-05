import { createFileRoute } from "@tanstack/react-router";

import { loans } from "@/api/loans/http";

export const Route = createFileRoute("/api/loans/$id/")({
  server: {
    handlers: {
      POST: loans.postRepayment,
      DELETE: loans.deleteLoan,
    },
  },
});
