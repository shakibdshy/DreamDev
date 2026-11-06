import { createFileRoute } from "@tanstack/react-router";

import { telegram } from "@/telegram/http";

export const Route = createFileRoute("/api/telegram/pair")({
  server: {
    handlers: {
      POST: telegram.postPair,
      DELETE: telegram.postUnlink,
    },
  },
});
