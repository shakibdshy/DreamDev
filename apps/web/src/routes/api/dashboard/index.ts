import { createFileRoute } from "@tanstack/react-router";

import { dashboardApi } from "@/api/dashboard/http";

const dashboard = dashboardApi();

export const Route = createFileRoute("/api/dashboard/")({
  server: {
    handlers: {
      GET: dashboard.getDashboard,
    },
  },
});
