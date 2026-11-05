import { appContext, ok, readBody, withApi, type ApiResolver } from "../route-helpers";

import { createBank, listBanks, purgeBank, softDeleteBank, updateBank } from "./service";

/** HTTP handlers for /api/banks — thin wiring over the service, testable with an injected resolver. */

export function banksApi(resolve: ApiResolver) {
  return {
    getList: withApi(async (ctx, request) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      return listBanks(ctx, query);
    }, resolve),

    postCreate: withApi(async (ctx, request) => ok(await createBank(ctx, await readBody(request)), 201), resolve),

    patchUpdate: withApi(async (ctx, request, params) => updateBank(ctx, params.id, await readBody(request)), resolve),

    deleteBank: withApi(async (ctx, request, params) => {
      const purge = new URL(request.url).searchParams.get("purge") === "true";
      return purge ? purgeBank(ctx, params.id) : softDeleteBank(ctx, params.id);
    }, resolve),
  };
}

export const banks = banksApi(appContext);
