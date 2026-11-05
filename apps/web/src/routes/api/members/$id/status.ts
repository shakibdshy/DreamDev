import { createFileRoute } from "@tanstack/react-router";

import { members } from "@/api/members/http";

export const Route = createFileRoute("/api/members/$id/status")({
  server: {
    handlers: {
      POST: members.postStatus,
    },
  },
});
