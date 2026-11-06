import { createFileRoute } from "@tanstack/react-router";

import { telegram } from "@/telegram/http";

export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: telegram.postWebhook,
    },
  },
});
