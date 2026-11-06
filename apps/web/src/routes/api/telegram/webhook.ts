import { createFileRoute } from "@tanstack/react-router";

import { telegram } from "@/telegram/http";

// Telegram retries non-2xx; keep the window tight.
export const maxDuration = 15;

export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: telegram.postWebhook,
    },
  },
});
