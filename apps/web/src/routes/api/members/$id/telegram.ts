import { createFileRoute } from "@tanstack/react-router";

import { members } from "@/api/members/http";

export const Route = createFileRoute("/api/members/$id/telegram")({
  server: {
    handlers: {
      POST: members.postTelegramPair,
      GET: members.getTelegramStatus,
      DELETE: members.deleteTelegram,
    },
  },
});
