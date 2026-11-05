import { createFileRoute } from "@tanstack/react-router";

import { members } from "@/api/members/http";

export const Route = createFileRoute("/api/members/$id/")({
  server: {
    handlers: {
      GET: members.getDetail,
      PATCH: members.patchUpdate,
      DELETE: members.deleteMember,
    },
  },
});
