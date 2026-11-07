import { createFileRoute } from "@tanstack/react-router";

import { loans } from "@/api/loans/http";

export const Route = createFileRoute("/api/loans/repayments/$id/")({
  server: {
    handlers: {
      DELETE: loans.deleteRepayment,
    },
  },
});
