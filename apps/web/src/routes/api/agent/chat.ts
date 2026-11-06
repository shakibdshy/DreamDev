import { createFileRoute } from "@tanstack/react-router";

import { agent } from "@/agent/http";

export const Route = createFileRoute("/api/agent/chat")({
  server: {
    handlers: {
      POST: agent.postChat,
      GET: agent.getHistory,
    },
  },
});
