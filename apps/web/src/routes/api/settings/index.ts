import { createFileRoute } from "@tanstack/react-router";

import { settings } from "@/api/settings/http";

export const Route = createFileRoute("/api/settings/")({
  server: {
    handlers: {
      GET: settings.get,
      PATCH: settings.patch,
    },
  },
});
