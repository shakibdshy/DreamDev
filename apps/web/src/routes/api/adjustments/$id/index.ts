import { createFileRoute } from "@tanstack/react-router";

import { ledger } from "@/api/ledger/http";

export const Route = createFileRoute("/api/adjustments/$id/")({
  server: {
    handlers: {
      PATCH: ledger.patchAdjustment,
      DELETE: ledger.deleteAdjustment,
    },
  },
});
