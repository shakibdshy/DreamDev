import { appContext, readBody, withApi, type ApiResolver } from "../route-helpers";

import { getSharePrice, updateSharePrice } from "./service";

/** HTTP handlers for /api/settings. */

export function settingsApi(resolve: ApiResolver) {
  return {
    get: withApi(async (ctx) => getSharePrice(ctx), resolve),
    patch: withApi(async (ctx, request) => updateSharePrice(ctx, await readBody(request)), resolve),
  };
}

export const settings = settingsApi(appContext);
