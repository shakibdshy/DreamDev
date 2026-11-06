import { createFileRoute } from "@tanstack/react-router";

import { telegram } from "@/telegram/http";

export const Route = createFileRoute("/api/telegram/status")({
  server: {
    handlers: {
      GET: telegram.getStatus,
    },
  },
});
