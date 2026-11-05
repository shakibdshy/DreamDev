import { appContext, withApi } from "../route-helpers";

import { dashboard as dashboardFn } from "./service";

/** HTTP handler for /api/dashboard. */

export function dashboardApi() {
  return {
    getDashboard: withApi(async (ctx, request) => {
      const year = new URL(request.url).searchParams.get("year");
      return dashboardFn(ctx, year ? Number(year) : undefined);
    }, appContext),
  };
}
