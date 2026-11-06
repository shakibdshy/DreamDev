import { appContext, ok, readBody, withApi, type ApiResolver } from "../route-helpers";

import { createContribution, listFeed, memberPosition, softDeleteContribution, updateContribution } from "./service";

/** HTTP handlers for the unified feed and Contributions. */

export function transactionsApi(resolve: ApiResolver) {
  return {
    getFeed: withApi(async (ctx, request) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      return listFeed(ctx, query);
    }, resolve),

    postContribution: withApi(async (ctx, request) => ok(await createContribution(ctx, await readBody(request)), 201), resolve),

    patchContribution: withApi(async (ctx, request, params) => updateContribution(ctx, params.id, await readBody(request)), resolve),

    deleteContribution: withApi(async (ctx, _request, params) => softDeleteContribution(ctx, params.id), resolve),
  };
}

export const transactions = transactionsApi(appContext);

/** Lives under /api/members/:id — kept here because it serves the Contribution form. */
export function positionApi(resolve: ApiResolver) {
  return {
    getPosition: withApi(async (ctx, _request, params) => memberPosition(ctx, params.id), resolve),
  };
}

export const positions = positionApi(appContext);
