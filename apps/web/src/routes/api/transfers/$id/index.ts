import { createFileRoute } from "@tanstack/react-router";

import { ledger } from "@/api/ledger/http";

export const Route = createFileRoute("/api/transfers/$id/")({
  server: {
    handlers: {
      PATCH: ledger.patchTransfer,
      DELETE: ledger.deleteTransfer,
    },
  },
});
