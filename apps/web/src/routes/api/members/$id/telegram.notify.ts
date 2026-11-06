import { createFileRoute } from "@tanstack/react-router";

import { members } from "@/api/members/http";

export const Route = createFileRoute("/api/members/$id/telegram/notify")({
  server: {
    handlers: {
      POST: members.postTelegramNotify,
    },
  },
});
