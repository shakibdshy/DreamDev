import { createFileRoute } from "@tanstack/react-router";

import { members } from "@/api/members/http";

export const Route = createFileRoute("/api/members/")({
  server: {
    handlers: {
      GET: members.getList,
      POST: members.postCreate,
    },
  },
});
