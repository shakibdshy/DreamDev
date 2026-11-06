import { createFileRoute } from "@tanstack/react-router";

import { agent } from "@/agent/http";

// Vercel function duration: agent turns stream SSE and may take up to a minute.
export const maxDuration = 60;

export const Route = createFileRoute("/api/agent/chat")({
  server: {
    handlers: {
      POST: agent.postChat,
      GET: agent.getHistory,
    },
  },
});
